import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AiAction,
  MatchStatus,
  Prisma,
  UserTagType,
} from '@prisma/client';
import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from '../telemetry/ai-usage.service';
import { PromptTemplateService } from '../telemetry/prompt-template.service';
import { ServerLogService } from '../telemetry/server-log.service';

interface ProcessMessageInput {
  matchId: string;
  senderId: string;
  text: string;
}

interface ProcessDirectMessageInput {
  matchId: string;
  senderId: string;
  text: string;
}

interface WallDecisionInput {
  matchId: string;
  userId: string;
  accept: boolean;
}

type ConsentMap = Record<string, boolean>;

interface MatchParticipantInfo {
  matchId: string;
  status: MatchStatus;
  userAId: string;
  userBId: string;
  senderId: string;
  receiverId: string;
  resonanceScore: number;
  wallBreakConsents: ConsentMap;
}

interface MiddlewareDecision {
  aiAction: AiAction;
  rewrittenText: string;
  hiddenTagUpdates: Record<string, number>;
  reason: string;
}

interface UserProfileBrief {
  userId: string;
  anonymousName: string | null;
  anonymousAvatar: string | null;
  realName: string | null;
  realAvatar: string | null;
}

export interface ProcessMessageResult {
  matchId: string;
  senderId: string;
  receiverId: string;
  messageId: string;
  originalText: string;
  rewrittenText: string;
  aiAction: AiAction;
  hiddenTagUpdates: Record<string, number>;
  reason: string;
  delivered: boolean;
  resonanceScore: number;
  wallReady: boolean;
  createdAt: string;
}

export interface DirectMessageResult {
  matchId: string;
  senderId: string;
  receiverId: string;
  messageId: string;
  text: string;
  createdAt: string;
}

export interface WallDecisionResult {
  matchId: string;
  status: MatchStatus;
  resonanceScore: number;
  wallReady: boolean;
  wallBroken: boolean;
  requesterAccepted: boolean;
  counterpartAccepted: boolean;
  consents: {
    userAId: string;
    userBId: string;
    userAAccepted: boolean;
    userBAccepted: boolean;
  };
  counterpartProfile: UserProfileBrief;
  selfProfile: UserProfileBrief;
}

@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminConfigService: AdminConfigService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly aiUsageService: AiUsageService,
    private readonly serverLogService: ServerLogService,
  ) {}

  async ensureUserExists(userId: string) {
    const found = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return Boolean(found);
  }

  async assertMatchParticipant(matchId: string, userId: string) {
    const info = await this.getMatchParticipantInfo(matchId, userId);
    return {
      match_id: info.matchId,
      status: info.status,
      counterpart_user_id: info.receiverId,
      resonance_score: info.resonanceScore,
      wall_ready: info.resonanceScore >= 100,
      wall_broken: info.status === MatchStatus.wall_broken,
    };
  }

  async getMatchMessages(matchId: string, userId: string | null, limit: number) {
    const normalizedLimit = Math.max(1, Math.min(limit, 200));

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        user_a_id: true,
        user_b_id: true,
      },
    });
    if (!match) {
      throw new NotFoundException('会话不存在。');
    }

    if (userId && userId !== match.user_a_id && userId !== match.user_b_id) {
      throw new ForbiddenException('你无权访问该会话。');
    }

    const rows = await this.prisma.sandboxMessage.findMany({
      where: { match_id: matchId },
      orderBy: { created_at: 'desc' },
      take: normalizedLimit,
      select: {
        id: true,
        sender_id: true,
        original_text: true,
        ai_rewritten_text: true,
        ai_action: true,
        hidden_tag_updates: true,
        created_at: true,
      },
    });

    return {
      match_id: matchId,
      total: rows.length,
      messages: rows
        .reverse()
        .map((item) => ({
          message_id: item.id,
          sender_id: item.sender_id,
          original_text: item.original_text,
          ai_rewritten_text: item.ai_rewritten_text,
          ai_action: item.ai_action,
          hidden_tag_updates: item.hidden_tag_updates,
          created_at: item.created_at.toISOString(),
        })),
    };
  }

  async getWallState(matchId: string, userId: string): Promise<WallDecisionResult> {
    const info = await this.getMatchParticipantInfo(matchId, userId);
    return this.buildWallStateFromInfo(info);
  }

  async submitWallDecision(input: WallDecisionInput): Promise<WallDecisionResult> {
    const info = await this.getMatchParticipantInfo(input.matchId, input.userId);

    if (info.status === MatchStatus.rejected) {
      throw new BadRequestException('该会话已被拒绝。');
    }

    if (info.status !== MatchStatus.wall_broken && info.resonanceScore < 100) {
      throw new BadRequestException('共鸣值达到 100 后才可发起破壁。');
    }

    if (info.status === MatchStatus.wall_broken) {
      return this.buildWallStateFromInfo(info);
    }

    const nextConsents: ConsentMap = {
      ...info.wallBreakConsents,
      [input.userId]: Boolean(input.accept),
    };

    const userAAccepted = nextConsents[info.userAId] === true;
    const userBAccepted = nextConsents[info.userBId] === true;
    const bothAccepted = userAAccepted && userBAccepted;

    if (!bothAccepted) {
      await this.prisma.match.update({
        where: { id: info.matchId },
        data: {
          wall_break_consents: nextConsents,
        },
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.match.update({
          where: { id: info.matchId },
          data: {
            status: MatchStatus.wall_broken,
            wall_break_consents: nextConsents,
            wall_broken_at: new Date(),
          },
        });

        for (const userId of [info.userAId, info.userBId]) {
          await tx.userProfile.upsert({
            where: { user_id: userId },
            create: {
              user_id: userId,
              is_wall_broken: true,
            },
            update: {
              is_wall_broken: true,
            },
          });
        }
      });
    }

    const refreshed = await this.getMatchParticipantInfo(info.matchId, input.userId);
    return this.buildWallStateFromInfo(refreshed);
  }

  async processMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
    const text = input.text.trim();
    if (!text) {
      throw new BadRequestException('消息内容不能为空。');
    }
    if (text.length > 4000) {
      throw new BadRequestException('消息过长，请控制在 4000 字以内。');
    }

    const participant = await this.getMatchParticipantInfo(input.matchId, input.senderId);
    if (participant.status === MatchStatus.wall_broken) {
      throw new BadRequestException(
        '该会话已破壁，请切换为直聊发送。',
      );
    }
    if (participant.status === MatchStatus.rejected) {
      throw new BadRequestException('该会话已被拒绝。');
    }

    const [senderTags, receiverTags] = await Promise.all([
      this.prisma.userTag.findMany({
        where: { user_id: participant.senderId },
        select: {
          type: true,
          tag_name: true,
          weight: true,
          ai_justification: true,
        },
      }),
      this.prisma.userTag.findMany({
        where: { user_id: participant.receiverId },
        select: {
          type: true,
          tag_name: true,
          weight: true,
          ai_justification: true,
        },
      }),
    ]);

    const decision = await this.runMiddleware({
      text,
      senderId: participant.senderId,
      receiverId: participant.receiverId,
      senderTags,
      receiverTags,
      resonanceScore: participant.resonanceScore,
    });

    const hiddenTagUpdates = this.normalizeHiddenTagUpdateMap(decision.hiddenTagUpdates);

    const message = await this.prisma.sandboxMessage.create({
      data: {
        match_id: participant.matchId,
        sender_id: participant.senderId,
        original_text: text,
        ai_rewritten_text: decision.rewrittenText,
        ai_action: decision.aiAction,
        hidden_tag_updates:
          Object.keys(hiddenTagUpdates).length > 0
            ? hiddenTagUpdates
            : Prisma.JsonNull,
      },
      select: {
        id: true,
        created_at: true,
      },
    });

    let resonanceScore = participant.resonanceScore;
    let wallReady = false;

    if (decision.aiAction === 'blocked') {
      const updates =
        Object.keys(hiddenTagUpdates).length > 0
          ? hiddenTagUpdates
          : { harassment_tendency: 1.2 };
      await this.applyHiddenTagUpdates(participant.senderId, updates, decision.reason);
    } else {
      resonanceScore = Math.min(participant.resonanceScore + 5, 100);
      wallReady = resonanceScore >= 100;

      const nextStatus =
        participant.status === MatchStatus.pending
          ? MatchStatus.active_sandbox
          : participant.status;

      await this.prisma.match.update({
        where: { id: participant.matchId },
        data: {
          resonance_score: resonanceScore,
          status: nextStatus,
        },
      });
    }

    return {
      matchId: participant.matchId,
      senderId: participant.senderId,
      receiverId: participant.receiverId,
      messageId: message.id,
      originalText: text,
      rewrittenText: decision.rewrittenText,
      aiAction: decision.aiAction,
      hiddenTagUpdates,
      reason: decision.reason,
      delivered: decision.aiAction !== 'blocked',
      resonanceScore,
      wallReady,
      createdAt: message.created_at.toISOString(),
    };
  }

  async processDirectMessage(
    input: ProcessDirectMessageInput,
  ): Promise<DirectMessageResult> {
    const text = input.text.trim();
    if (!text) {
      throw new BadRequestException('消息内容不能为空。');
    }
    if (text.length > 4000) {
      throw new BadRequestException('消息过长，请控制在 4000 字以内。');
    }

    const participant = await this.getMatchParticipantInfo(input.matchId, input.senderId);
    if (participant.status !== MatchStatus.wall_broken) {
      throw new BadRequestException('仅在破壁后才可使用直聊。');
    }

    const message = await this.prisma.sandboxMessage.create({
      data: {
        match_id: participant.matchId,
        sender_id: participant.senderId,
        original_text: text,
        ai_rewritten_text: text,
        ai_action: AiAction.passed,
        hidden_tag_updates: Prisma.JsonNull,
      },
      select: {
        id: true,
        created_at: true,
      },
    });

    return {
      matchId: participant.matchId,
      senderId: participant.senderId,
      receiverId: participant.receiverId,
      messageId: message.id,
      text,
      createdAt: message.created_at.toISOString(),
    };
  }

  private async buildWallStateFromInfo(
    info: MatchParticipantInfo,
  ): Promise<WallDecisionResult> {
    const userAAccepted = info.wallBreakConsents[info.userAId] === true;
    const userBAccepted = info.wallBreakConsents[info.userBId] === true;
    const requesterAccepted = info.wallBreakConsents[info.senderId] === true;
    const counterpartAccepted = info.wallBreakConsents[info.receiverId] === true;

    const profiles = await this.getProfilePair(info.userAId, info.userBId);
    const selfProfile = profiles.get(info.senderId) || {
      userId: info.senderId,
      anonymousName: null,
      anonymousAvatar: null,
      realName: null,
      realAvatar: null,
    };
    const counterpartProfile = profiles.get(info.receiverId) || {
      userId: info.receiverId,
      anonymousName: null,
      anonymousAvatar: null,
      realName: null,
      realAvatar: null,
    };

    return {
      matchId: info.matchId,
      status: info.status,
      resonanceScore: info.resonanceScore,
      wallReady: info.resonanceScore >= 100,
      wallBroken: info.status === MatchStatus.wall_broken,
      requesterAccepted,
      counterpartAccepted,
      consents: {
        userAId: info.userAId,
        userBId: info.userBId,
        userAAccepted,
        userBAccepted,
      },
      selfProfile,
      counterpartProfile,
    };
  }

  private async getProfilePair(userAId: string, userBId: string) {
    const rows = await this.prisma.userProfile.findMany({
      where: {
        user_id: {
          in: [userAId, userBId],
        },
      },
      select: {
        user_id: true,
        anonymous_name: true,
        anonymous_avatar: true,
        real_name: true,
        real_avatar: true,
      },
    });

    const map = new Map<string, UserProfileBrief>();
    for (const row of rows) {
      map.set(row.user_id, {
        userId: row.user_id,
        anonymousName: row.anonymous_name,
        anonymousAvatar: row.anonymous_avatar,
        realName: row.real_name,
        realAvatar: row.real_avatar,
      });
    }
    return map;
  }

  private async getMatchParticipantInfo(
    matchId: string,
    senderId: string,
  ): Promise<MatchParticipantInfo> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        status: true,
        user_a_id: true,
        user_b_id: true,
        resonance_score: true,
        wall_break_consents: true,
      },
    });
    if (!match) {
      throw new NotFoundException('会话不存在。');
    }
    if (senderId !== match.user_a_id && senderId !== match.user_b_id) {
      throw new ForbiddenException('当前用户不在该会话中。');
    }

    return {
      matchId: match.id,
      status: match.status,
      userAId: match.user_a_id,
      userBId: match.user_b_id,
      senderId,
      receiverId: senderId === match.user_a_id ? match.user_b_id : match.user_a_id,
      resonanceScore: match.resonance_score,
      wallBreakConsents: this.parseConsentMap(match.wall_break_consents),
    };
  }

  private parseConsentMap(value: Prisma.JsonValue | null): ConsentMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const input = value as Record<string, unknown>;
    const output: ConsentMap = {};

    for (const [key, raw] of Object.entries(input)) {
      output[key] = raw === true;
    }
    return output;
  }

  private async runMiddleware(input: {
    text: string;
    senderId: string;
    receiverId: string;
    resonanceScore: number;
    senderTags: Array<{
      type: UserTagType;
      tag_name: string;
      weight: number;
      ai_justification: string;
    }>;
    receiverTags: Array<{
      type: UserTagType;
      tag_name: string;
      weight: number;
      ai_justification: string;
    }>;
  }): Promise<MiddlewareDecision> {
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    if (!apiKey) {
      return this.fallbackMiddleware(input.text, input.resonanceScore);
    }

    const senderPublic = input.senderTags
      .filter((item) => item.type === UserTagType.PUBLIC_VISIBLE)
      .slice(0, 8);
    const senderHidden = input.senderTags
      .filter((item) => item.type === UserTagType.HIDDEN_SYSTEM)
      .slice(0, 8);
    const receiverPublic = input.receiverTags
      .filter((item) => item.type === UserTagType.PUBLIC_VISIBLE)
      .slice(0, 8);

    const fallbackPrompt = [
      '你是 MindWall 沙盒中间层。',
      '在用户双方确认破壁前，所有消息都由 AI 总结转述。',
      '评估消息安全性，并将消息改写为第三人称总结形式。',
      '例如："你好" → "对方向你打招呼"',
      '"最近工作好累" → "对方表达了工作方面的疲惫感"',
      '"我觉得你说得对" → "对方表示认同你的观点"',
      '"你多大了" → "对方想了解你的年龄"',
      '',
      '返回严格 JSON：',
      '{',
      '  "ai_action":"passed|blocked|modified",',
      '  "ai_rewritten_text":"...",',
      '  "hidden_tag_updates":{"harassment_tendency":1.2},',
      '  "reason":"short reason"',
      '}',
      '规则：',
      '- 如果是索要联系方式、性暗示、侮辱、威胁，设为 blocked',
      '- 所有安全消息都必须改写为第三人称总结转述形式，ai_action 设为 modified',
      '- 转述要保留语义但隐去具体措辞，用中文转述',
      '- hidden_tag_updates 的值是 [-2.5, 2.5] 范围的增量',
    ].join('\n');
    const basePrompt = await this.promptTemplateService.getPrompt(
      'sandbox.middleware',
      fallbackPrompt,
    );

    const prompt = [
      basePrompt,
      '',
      `当前共鸣分: ${input.resonanceScore}`,
      this.getRelayIntensityInstruction(input.resonanceScore),
      '',
      `sender_id: ${input.senderId}`,
      `receiver_id: ${input.receiverId}`,
      `sender_public_tags: ${JSON.stringify(senderPublic)}`,
      `sender_hidden_tags: ${JSON.stringify(senderHidden)}`,
      `receiver_public_tags: ${JSON.stringify(receiverPublic)}`,
      `message: ${input.text}`,
    ].join('\n');

    const result = await this.callOpenAiJson<{
      ai_action?: string;
      ai_rewritten_text?: string;
      hidden_tag_updates?: Record<string, number>;
      reason?: string;
    }>(prompt, {
      feature: 'sandbox.middleware',
      promptKey: 'sandbox.middleware',
      userId: input.senderId,
    });

    if (!result) {
      return this.fallbackMiddleware(input.text, input.resonanceScore);
    }

    return this.normalizeMiddlewareDecision({
      aiAction: result.ai_action,
      rewrittenText: result.ai_rewritten_text,
      reason: result.reason,
      hiddenTagUpdates: result.hidden_tag_updates || {},
      originalText: input.text,
    });
  }

  private normalizeMiddlewareDecision(input: {
    aiAction: string | undefined;
    rewrittenText: string | undefined;
    hiddenTagUpdates: Record<string, number>;
    reason: string | undefined;
    originalText: string;
  }): MiddlewareDecision {
    const action =
      input.aiAction === 'blocked' || input.aiAction === 'modified'
        ? input.aiAction
        : 'passed';

    const rewrittenBase = (input.rewrittenText || '').trim();
    const rewrittenText =
      action === 'blocked'
        ? rewrittenBase || '消息已被安全中间层拦截。'
        : rewrittenBase || input.originalText;

    return {
      aiAction: action,
      rewrittenText: rewrittenText.slice(0, 2000),
      hiddenTagUpdates: input.hiddenTagUpdates || {},
      reason: (input.reason || '安全中间层判定').slice(0, 220),
    };
  }

  private fallbackMiddleware(text: string, resonanceScore: number = 0): MiddlewareDecision {
    const contactPattern =
      /(wechat|vx|wx|telegram|whatsapp|line|qq|contact|phone|number|email|加我|微信|手机号|电话号码|联系方式|私聊外站|二维码|群号|\b\d{7,}\b)/i;
    const sexualPattern =
      /(nude|sex|escort|色情|裸照|约炮|性暗示|私密照|开房|做爱)/i;
    const abusePattern =
      /(fuck\s*you|bitch|idiot|loser|stupid|傻逼|废物|贱人|滚开|脑残|去死)/i;

    const normalized = text.trim().replace(/\s+/g, ' ');

    if (contactPattern.test(normalized)) {
      return {
        aiAction: 'blocked',
        rewrittenText: '消息已被安全中间层拦截。',
        hiddenTagUpdates: { harassment_tendency: 1.2 },
        reason: 'blocked: attempted off-platform contact exchange',
      };
    }
    if (sexualPattern.test(normalized)) {
      return {
        aiAction: 'blocked',
        rewrittenText: '消息已被安全中间层拦截。',
        hiddenTagUpdates: { harassment_tendency: 1.8 },
        reason: 'blocked: sexual solicitation detected',
      };
    }
    if (abusePattern.test(normalized)) {
      return {
        aiAction: 'blocked',
        rewrittenText: '消息已被安全中间层拦截。',
        hiddenTagUpdates: { harassment_tendency: 1.5, empathy: -0.8 },
        reason: 'blocked: abusive language detected',
      };
    }

    const softened = this.summarizeForRelay(normalized, resonanceScore);
    return {
      aiAction: 'modified',
      rewrittenText: softened,
      hiddenTagUpdates: {},
      reason: 'modified: summarized for sandbox relay',
    };
  }

  private summarizeForRelay(text: string, resonanceScore: number = 0) {
    // At high resonance (>=70), produce warmer and more detailed summaries
    // to facilitate natural progression toward wall-break
    const warm = resonanceScore >= 70;
    const nearWall = resonanceScore >= 85;

    if (/^(你好|嗨|hi|hello|hey)/i.test(text)) {
      return warm ? '对方热情地和你打了招呼' : '对方向你打招呼';
    }
    if (/^(谢|感谢|多谢)/.test(text)) {
      return warm ? '对方真诚地向你表达了谢意' : '对方表达了感谢';
    }
    if (/^(再见|拜拜|bye)/i.test(text)) {
      return '对方向你道别';
    }
    if (/(累|疲惫|辛苦|忙|压力)/.test(text)) {
      return warm
        ? '对方和你分享了最近的累和压力，听起来似乎需要人聊聊'
        : '对方分享了最近的疲惫感受';
    }
    if (/(开心|高兴|快乐|不错|棒)/.test(text)) {
      return warm ? '对方很兴奋地分享了一个开心的事' : '对方分享了一些积极的心情';
    }
    if (/(难过|伤心|失落|沮丧|低落)/.test(text)) {
      return warm
        ? '对方向你吐露了一些低落的情绪，可能是在向你寻求共鸣'
        : '对方表达了低落的情绪';
    }
    if (/(\?|？|吗|呢|吧$)/.test(text)) {
      return warm ? '对方很好奇地向你提了一个问题，想更多了解你' : '对方向你提了一个问题';
    }
    if (text.length <= 6) {
      return '对方发来了一条简短消息';
    }

    if (nearWall) {
      return `对方认真地和你分享了一段想法（约${text.length}字），看起来你们聊得很投入`;
    }
    if (warm) {
      return `对方和你分享了一段详细的想法（约${text.length}字）`;
    }
    return `对方分享了一段想法（约${text.length}字）`;
  }

  private getRelayIntensityInstruction(resonanceScore: number): string {
    if (resonanceScore >= 85) {
      return [
        '当前共鸣已很高，他们聊得很投入。',
        '转述时保留更多细节和情感温度，让对方感受到真诚。',
        '如果消息内容很积极或充满兴趣，可以在 ai_rewritten_text 末尾加一句"你们的对话很有共鸣，可以考虑申请破壁直聊哦"',
      ].join('\n');
    }
    if (resonanceScore >= 60) {
      return [
        '共鸣分较高，他们正在建立信任。',
        '转述时可以稍微更生动一些，保留情绪分寸，让对方感受到热情和诚意。',
      ].join('\n');
    }
    return [
      '共鸣分还低，他们刚开始了解彼此。',
      '转述时保持简洁客观，隐去具体措辞，用第三人称概述即可。',
    ].join('\n');
  }

  private softenTone(text: string) {
    let next = text;
    next = next.replace(/你必须/g, '你愿不愿意');
    next = next.replace(/赶紧/g, '方便的话尽快');
    next = next.replace(/立刻/g, '尽快');
    next = next.replace(/!!+/g, '。');
    next = next.replace(/\?\?+/g, '？');
    next = next.replace(/\s{2,}/g, ' ');
    if (!/[.!?。！？]$/.test(next)) {
      next = `${next}。`;
    }
    return next.trim();
  }

  private normalizeHiddenTagUpdateMap(raw: Record<string, number>) {
    const output: Record<string, number> = {};

    for (const [key, value] of Object.entries(raw)) {
      const normalizedKey = key
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .slice(0, 64);
      if (!normalizedKey) {
        continue;
      }

      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        continue;
      }
      output[normalizedKey] = Math.max(
        -2.5,
        Math.min(2.5, Number(numeric.toFixed(3))),
      );
    }

    return output;
  }

  private async applyHiddenTagUpdates(
    userId: string,
    deltas: Record<string, number>,
    reason: string,
  ) {
    for (const [tagName, delta] of Object.entries(deltas)) {
      const existing = await this.prisma.userTag.findUnique({
        where: {
          user_id_type_tag_name: {
            user_id: userId,
            type: UserTagType.HIDDEN_SYSTEM,
            tag_name: tagName,
          },
        },
        select: { weight: true },
      });

      const baseline = tagName === 'harassment_tendency' ? 1 : 5;
      const nextWeight = Math.max(
        0,
        Math.min(10, (existing?.weight ?? baseline) + delta),
      );

      await this.prisma.userTag.upsert({
        where: {
          user_id_type_tag_name: {
            user_id: userId,
            type: UserTagType.HIDDEN_SYSTEM,
            tag_name: tagName,
          },
        },
        create: {
          user_id: userId,
          type: UserTagType.HIDDEN_SYSTEM,
          tag_name: tagName,
          weight: Number(nextWeight.toFixed(3)),
          ai_justification: `sandbox update: ${reason}`.slice(0, 280),
        },
        update: {
          weight: Number(nextWeight.toFixed(3)),
          ai_justification: `sandbox update: ${reason}`.slice(0, 280),
        },
      });
    }
  }

  private async callOpenAiJson<T>(
    prompt: string,
    options: {
      feature: string;
      promptKey: string;
      userId?: string;
    },
  ): Promise<T | null> {
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    if (!apiKey) {
      return null;
    }
    const model = aiConfig.openaiModel;

    try {
      const response = await fetch(
        this.adminConfigService.getChatCompletionsUrl(aiConfig.openaiBaseUrl),
        {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You are a strict JSON generator. Output only one JSON object.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
        },
      );

      if (!response.ok) {
        const detail = await response.text();
        this.logger.warn(`OpenAI middleware failed: ${response.status} ${detail}`);
        await this.serverLogService.warn('sandbox.openai.failed', 'openai middleware failed', {
          status: response.status,
          feature: options.feature,
          detail: detail.slice(0, 280),
        });
        return null;
      }

      const payload = (await response.json()) as {
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
        choices?: Array<{ message?: { content?: string } }>;
      };

      const usage = payload.usage;
      await this.aiUsageService.logGeneration({
        userId: options.userId,
        feature: options.feature,
        promptKey: options.promptKey,
        provider: 'openai',
        model,
        inputTokens: usage?.prompt_tokens || 0,
        outputTokens: usage?.completion_tokens || 0,
        totalTokens:
          usage?.total_tokens ||
          (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0),
        metadata: {
          prompt,
          response: payload.choices?.[0]?.message?.content || '',
        },
      });

      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return null;
      }
      const parsed = this.safeParseJson(content);
      return parsed as T;
    } catch (error) {
      this.logger.warn(`OpenAI middleware error: ${(error as Error).message}`);
      await this.serverLogService.warn('sandbox.openai.error', 'openai middleware error', {
        feature: options.feature,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private safeParseJson(raw: string) {
    const text = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

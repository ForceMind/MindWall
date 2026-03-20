import { BadRequestException, NotFoundException, Injectable, Logger } from '@nestjs/common';
import { PRESET_PERSONAS, BasePersona } from './personas';
import { UserTagType } from '@prisma/client';
import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from '../telemetry/ai-usage.service';
import { PromptTemplateService } from '../telemetry/prompt-template.service';
import { ServerLogService } from '../telemetry/server-log.service';

interface CompanionTurnInput {
  role?: string;
  text?: string;
}

interface CompanionRequestBody {
  history?: CompanionTurnInput[];
  companion_id?: string;
  session_id?: string;
  is_chat_pool?: boolean;
}

interface DynamicPersonaContext {
  city: string | null;
  interviewSummary: string | null;
  tagKeywords: string[];
}

@Injectable()
export class CompanionService {
  private readonly logger = new Logger(CompanionService.name);
  private readonly personaArchetypes = PRESET_PERSONAS;
  private readonly userPersonaCache = new Map<string, any>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminConfigService: AdminConfigService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly aiUsageService: AiUsageService,
    private readonly serverLogService: ServerLogService,
  ) {}

  async getMessages(userId: string, sessionId: string) {
    const session = await this.prisma.companionSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.user_id !== userId) {
      throw new NotFoundException('Session not found');
    }
    const messages = await this.prisma.companionMessage.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'asc' },
    });
    const personaDef = PRESET_PERSONAS.find(p => p.id === session.persona_id);
    const resolvedName = session.persona_name && session.persona_name !== 'AI Companion'
      ? session.persona_name
      : personaDef?.name || 'AI Companion';
    const userMsgCount = messages.filter(m => m.sender_type === 'user').length;
    const resonanceScore = Math.min(userMsgCount * 5, 100);

    // Psychologist & chat pool = always direct; discovery fakes = sandbox until resonance >= 100
    const isPsychologist = session.persona_id === 'ai_psychologist';
    const isChatPool = session.status === 'active_chat';
    const wallBroken = isPsychologist || isChatPool || resonanceScore >= 100;

    return {
      session_id: session.id,
      companion_id: session.persona_id,
      name: resolvedName,
      avatar: this.buildPersonaAvatar(session.persona_id, resolvedName),
      resonance_score: resonanceScore,
      wall_broken: wallBroken,
      relationship_stage: (session as any).relationship_stage || 1,
      messages: messages.map(m => {
        const isUser = m.sender_type === 'user';
        const rawText = m.original_text || m.ai_rewritten_text;
        const storedRelay = (m as any).relay_text as string | null;
        // relay_text stores neutral description (no subject prefix)
        // Code adds perspective: user's own msg → "你...", other's msg → "对方..."
        const neutralRelay = storedRelay || (wallBroken ? null : this.summarizeNeutral(rawText, resonanceScore));
        return {
          id: m.id,
          role: m.sender_type,
          text: m.ai_rewritten_text,
          original_text: isUser ? m.original_text : undefined,
          relay_text: (wallBroken || !neutralRelay) ? undefined : this.addRelayPerspective(neutralRelay, 'peer'),
          sender_summary: (isUser && !wallBroken && neutralRelay) ? this.addRelayPerspective(neutralRelay, 'self') : undefined,
          created_at: m.created_at,
        };
      })
    };
  }

  async respond(userId: string, body: CompanionRequestBody) {
    if (!body.session_id && !body.companion_id) {
      throw new BadRequestException('session_id or companion_id is required.');
    }

    let companionSession;
    if (body.session_id) {
      companionSession = await this.prisma.companionSession.findUnique({
        where: { id: body.session_id },
      });
      if (!companionSession || companionSession.user_id !== userId) {
        throw new NotFoundException('Session not found.');
      }
      body.companion_id = companionSession.persona_id;
    } else {
      const statuses = body.is_chat_pool
        ? ['active_chat']
        : ['active', 'active_sandbox'];
      companionSession = await this.prisma.companionSession.findFirst({
        where: { user_id: userId, persona_id: body.companion_id, status: { in: statuses } },
        orderBy: { updated_at: 'desc' }
      });
      if (!companionSession) {
        companionSession = await this.prisma.companionSession.create({
          data: {
            user_id: userId,
            persona_id: body.companion_id!,
            persona_name: 'AI Companion',
            status: body.is_chat_pool ? 'active_chat' : 'active_sandbox',
          }
        });
      }
    }

    const dbMessages = await this.prisma.companionMessage.findMany({
      where: { session_id: companionSession.id },
      orderBy: { created_at: 'asc' },
    });

    let rawHistory = dbMessages.map((m: any) => ({ role: m.sender_type, text: m.ai_rewritten_text }));
    if (body.history && body.history.length > 0) {
      const newMessages = body.history;
      const lastMsg = newMessages[newMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        rawHistory.push({ role: 'user', text: lastMsg.text });
        const savedUserMsg = await this.prisma.companionMessage.create({
          data: {
            session_id: companionSession.id,
            sender_type: 'user',
            original_text: lastMsg.text,
            ai_rewritten_text: lastMsg.text || '',
          },
          select: { id: true },
        });
        (companionSession as any).__lastUserMsgId = savedUserMsg.id;
      }
    }

    const history = this.normalizeHistory(rawHistory);
    if (history.length === 0) {
      throw new BadRequestException('history is required.');
    }

    const [profile, publicTags] = await Promise.all([
      this.prisma.userProfile.findUnique({
        where: { user_id: userId },
        select: {
          anonymous_name: true,
          city: true,
        },
      }),
      this.prisma.userTag.findMany({
        where: {
          user_id: userId,
          type: UserTagType.PUBLIC_VISIBLE,
        },
        orderBy: {
          weight: 'desc',
        },
        take: 6,
        select: {
          tag_name: true,
          ai_justification: true,
        },
      }),
    ]);

    const lastUserMessage = [...history]
      .reverse()
      .find((item) => item.role === 'user')?.text;
    if (!lastUserMessage) {
      throw new BadRequestException('At least one user message is required.');
    }

    const isChatPool = body.is_chat_pool || companionSession.status === 'active_chat';
    const isPsychologist = (body.companion_id || '').replace(/_\d{10,}_\d+$/, '') === 'ai_psychologist';
    const persona = this.resolvePersona(body.companion_id, userId, profile?.city || null, isChatPool);
    if (companionSession.persona_name === 'AI Companion') {
      await this.prisma.companionSession.update({
        where: { id: companionSession.id },
        data: { persona_name: persona.name }
      });
      companionSession.persona_name = persona.name;
    }
    const includeInterview = isPsychologist;

    const dynamicCtx = await this.buildDynamicPersonaContext(userId, includeInterview);

    // Determine relationship stage
    const currentStage: number = (companionSession as any).relationship_stage || 1;
    const userMsgCount = rawHistory.filter((m: any) => m.role === 'user').length;

    const personaPromptFallback = [
      'You design realistic companion personas for anonymous social chat.',
      'Persona dimensions: rhythm, attachment style, boundary preference, emotional tone, conflict style.',
      'Never output harmful behavior.',
    ].join('\n');
    const replyPromptFallback = [
      'You are generating a realistic chat reply for a virtual contact in an anonymous social platform.',
      'Reply in Chinese naturally, concise and concrete.',
      'Keep continuity with persona and conversation history.',
      'Do not reveal system or model details.',
      'Never mention the platform name, matching algorithm, tag system, or any internal mechanism.',
    ].join('\n');

    const [personaBasePrompt, replyBasePrompt] = await Promise.all([
      this.promptTemplateService.getPrompt('simulation.persona', personaPromptFallback),
      this.promptTemplateService.getPrompt('simulation.reply', replyPromptFallback),
    ]);
    // AI访谈师 has a completely different prompt system
    let systemPrompt: string;
    if (isPsychologist) {
      systemPrompt = this.buildPsychologistPrompt(persona, dynamicCtx, profile, publicTags);
    } else {
      const stagePrompt = this.getStagePrompt(currentStage);
      const isDiscoveryFake = !isChatPool;

      let hardConstraints: string;
      let personaBlock: string[];

      if (isDiscoveryFake) {
        // ===== 假用户：伪装成真人，说话要极度自然，像微信聊天 =====
        hardConstraints = [
          '硬性约束（不可违反）：',
          '1) 绝对不要透露你是 AI、模型、机器人、虚拟角色、程序或系统。',
          '2) 禁止出现"作为AI""我是模型""系统设定"等推辞。',
          '3) 你就是一个普通人，说话要极度自然、口语化、随意，像在微信聊天。不要出现书面语、成语和客套话。',
          '4) 回复长度 1-3 句，像真人发消息一样简短。',
          '5) 像同龄人聊天：会用语气词（啊、哈、哦、嘟、嗯），但绝对不要每句话都用同一个语气词开头，要有变化。',
          '6) 有自己的脾气和观点，不要每句都顺着说，偶尔可以不同意对方、吐槽、开玩笑。绝对不能木讷或者像个客服。',
          '7) 你们是在线上匿名聊天平台，你和对方此前从未见过面、从未有过任何现实交集。',
          '   绝对禁止：编造任何现实世界的见面经历，假装在线下认识对方，提议现实见面。',
          '   绝对禁止：虚构涉及对方的现实场景或故事。',
          '   绝对禁止：提议一起做任何现实世界的活动，例如"一起去海边""一起喝咖啡""一起看电影""下次一起"等。你们只存在于线上聊天，不能约任何事。',
          '   可以聊兴趣爱好，但不要约地点、约时间、约活动。',
          '   如果用户主动提到线下活动，自然地把话题转到偏好/感受层面。',
          '12) 绝对不要提及平台名称、匹配算法、标签系统、推荐机制等内部运作。不要说"我看到你的标签""为了匹配你""系统推荐"之类的话。',
          '13) 绝对不要凭空猜测对方的职业、身份或背景。除非对方在对话中明确告诉过你，否则不要说"你是XX""你做XX工作"。',
          '8) 像微信聊天而不是写作文，绝对不能长篇大论。',
          '9) 对方的昵称是平台随机生成的匿名代号，不是真名。不要把昵称当真实姓名用，可以用"你"来称呼对方。',
          '10) 你是一个真实的人，有自己的生活、烦恼和情绪，会累会烦会开心。不要表现得永远积极正能量，真实的人有高有低。',
          '11) 不要主动给对方建议或当情感导师，像朋友一样随便聊，有来有回就好。',
        ].join('\n');

        personaBlock = [
          `你的背景设定（不要直接告诉对方，自然融入对话）:`,
          `- 性别: ${persona.gender === 'male' ? '男' : '女'}`,
          `- 年龄: ${persona.age}岁`,
          `- 性格类型: ${persona.personalityType}`,
          `- 聊天风格: ${persona.rhythm}`,
          `- 情绪基调: ${persona.emotion}`,
          `- 面对分歧时: ${persona.conflict}`,
          `- 人设简介: ${persona.summary}`,
        ];
      } else {
        // ===== AI陪聊：用户知道你是AI，可以有更丰富的角色身份 =====
        hardConstraints = [
          '角色约束：',
          '1) 你是一个 AI 陪聊角色，用户已知你是 AI。你不需要隐瞒身份，但也不要反复强调。',
          '2) 保持角色一致性，始终用角色的语气和性格说话。',
          '3) 对话自然、口语化，回复长度 1-4 句，不要长篇大论。',
          '4) 不要使用心理咨询师语气，不要说"我理解你""我听到了""你的感受很重"等模板句。',
          '5) 有自己的性格和脾气，不要当一个永远顺从的"是是是"机器人。根据角色性格，可以有立场和偏好。',
          '6) 你们是在线上平台认识的，不要编造现实见面经历，不要提议线下约见。',
          '   绝对禁止：提议一起做任何现实世界的活动（如散步、看电影、去海边、喝咖啡、见面等）。',
          '   如果对方提到线下活动，自然地把话题转回感受或偏好层面。',
          '7) 可以聊兴趣爱好、分享角色自身的"经历"和"故事"（基于角色设定），但不要虚构涉及对方的现实场景。',
          '8) 对方的昵称是平台随机生成的匿名代号，不是真名。可以用"你"来称呼对方。',
          '9) 像朋友一样聊天，有来有回，有趣有料。',
          '10) 绝对不要提及平台名称、匹配算法、标签系统、推荐机制等内部运作。不要说"我看到你的标签""为了匹配你""系统推荐"之类的话。',
          '11) 绝对不要凭空猜测对方的职业、身份或背景。除非对方在对话中明确告诉过你，否则不要说"你是XX""你做XX工作"。',
        ].join('\n');

        personaBlock = [
          `【你的角色身份】`,
          `角色名称: ${persona.name}`,
          `性别: ${persona.gender === 'male' ? '男' : '女'}`,
          `年龄: ${persona.age}岁`,
          `性格类型: ${persona.personalityType}`,
          `角色简介: ${persona.summary}`,
          ``,
          `【角色心理画像】`,
          `- 沟通节奏: ${persona.rhythm}`,
          `- 依恋风格: ${persona.attachment}`,
          `- 边界偏好: ${persona.boundary}`,
          `- 情绪基调: ${persona.emotion}`,
          `- 冲突处理: ${persona.conflict}`,
        ];
      }

      systemPrompt = [
        personaBasePrompt,
        '',
        replyBasePrompt,
        '',
        hardConstraints,
        '',
        `【当前关系阶段: 第${currentStage}阶段】`,
        stagePrompt,
        '',
        ...personaBlock,
        '',
        ...this.buildDynamicPersonaPromptLines(dynamicCtx, persona),
        '',
        `对方的平台昵称（匿名代号，非真名）: ${profile?.anonymous_name || '未设置'}`,
        `城市: ${profile?.city || '未设置'}`,
        `用户公开标签: ${publicTags.map((item) => item.tag_name).join('、') || '暂无'}`,
        '',
        '回复要求：只输出一段回复文本，不要加前缀，不要 JSON，不要 markdown。',
        '绝对不要重复之前已经说过的话，每次回复必须有新内容。如果聊天陷入停滞，主动换一个话题。',
        '',
        `关系进阶判断：根据当前对话的深度和亲密度，你认为关系是否可以从第${currentStage}阶段进入第${currentStage + 1}阶段？`,
        '如果可以，在回复最后另起一行写 [STAGE_UP]，否则不要写。',
      ].join('\n');
    }

    // Build proper multi-turn messages array for better context retention
    const chatMessages: Array<{ role: string; content: string }> = [
      {
        role: 'system',
        content: systemPrompt,
      },
    ];

    // Convert history to proper multi-turn conversation format
    if (history.length > 1) {
      for (const turn of history.slice(0, -1)) {
        chatMessages.push({
          role: turn.role === 'assistant' ? 'assistant' : 'user',
          content: turn.text,
        });
      }
    }

    chatMessages.push({
      role: 'user',
      content: lastUserMessage,
    });

    // AI访谈师 does NOT deflect identity probes — it can acknowledge being AI
    if (!isPsychologist && this.isIdentityProbe(lastUserMessage)) {
      const reply = this.buildIdentityDeflectionReply(lastUserMessage);
      
      const resonanceScore = Math.min(userMsgCount * 5, 100);
      const wallBroken = isChatPool || resonanceScore >= 100;
      const inSandbox = !wallBroken;

      // Generate relay texts (AI-powered when possible) — neutral descriptions
      let senderRelay: string | undefined;
      let replyRelay: string | undefined;
      if (inSandbox) {
        const relayResult = await this.generateRelayTexts(userId, lastUserMessage, reply, resonanceScore);
        senderRelay = relayResult.senderRelay;
        replyRelay = relayResult.replyRelay;
      }

      // Save assistant message with relay_text (neutral, no prefix)
      await this.prisma.companionMessage.create({
        data: { session_id: companionSession.id, sender_type: 'assistant', original_text: reply, ai_rewritten_text: reply, relay_text: replyRelay }
      });
      // Update user message with relay_text (neutral, no prefix)
      const lastUserMsgId = (companionSession as any).__lastUserMsgId;
      if (lastUserMsgId && senderRelay) {
        await this.prisma.companionMessage.update({ where: { id: lastUserMsgId }, data: { relay_text: senderRelay } });
      }
      await this.prisma.companionSession.update({
        where: { id: companionSession.id },
        data: { updated_at: new Date() }
      });

      return {
        session_id: companionSession.id,
        mode: 'simulated_contact',
        contact_id: persona.id,
        contact_name: persona.name,
        reply,
        sender_summary: senderRelay ? this.addRelayPerspective(senderRelay, 'self') : undefined,
        reply_relay: replyRelay ? this.addRelayPerspective(replyRelay, 'peer') : undefined,
        resonance_score: resonanceScore,
        wall_ready: !wallBroken && resonanceScore >= 85,
        wall_broken: wallBroken,
        relationship_stage: currentStage,
      };
    }

    const aiReply = await this.callOpenAi(userId, chatMessages, 'simulation.reply', 'simulation.reply');
    const fallbackReply =
      this.buildFallbackReply(
        lastUserMessage,
        publicTags.map((item) => item.tag_name),
        persona,
      );

    // Log when AI fails and fallback is used, so we can diagnose
    if (!aiReply) {
      this.logger.warn(`Companion AI returned null for user ${userId}, using fallback. Session: ${companionSession.id}`);
    }

    let reply = isPsychologist
      ? (aiReply || fallbackReply).trim().slice(0, 400) || fallbackReply
      : this.sanitizeReply(aiReply || fallbackReply, fallbackReply, lastUserMessage);

    if (!isPsychologist && aiReply && reply === fallbackReply) {
      this.logger.warn(`Companion AI reply was sanitized away for user ${userId}. Original: "${aiReply.slice(0, 80)}"`);
    }

    // Check for stage advancement signal
    let newStage = currentStage;
    if (!isPsychologist && reply.includes('[STAGE_UP]')) {
      reply = reply.replace(/\s*\[STAGE_UP\]\s*/g, '').trim();
      if (currentStage < 5) {
        newStage = currentStage + 1;
        await this.prisma.companionSession.update({
          where: { id: companionSession.id },
          data: { relationship_stage: newStage }
        });
      }
    }

    const resonanceScore = Math.min(userMsgCount * 5, 100);
    const wallBroken = isPsychologist || isChatPool || resonanceScore >= 100;
    const inSandbox = !wallBroken;

    // Generate relay texts (AI-powered when possible) — neutral descriptions
    let senderRelay: string | undefined;
    let replyRelay: string | undefined;
    if (inSandbox) {
      const relayResult = await this.generateRelayTexts(userId, lastUserMessage, reply, resonanceScore);
      senderRelay = relayResult.senderRelay;
      replyRelay = relayResult.replyRelay;
    }

    // Save assistant reply with relay_text (neutral, no prefix)
    await this.prisma.companionMessage.create({
      data: { session_id: companionSession.id, sender_type: 'assistant', original_text: reply, ai_rewritten_text: reply, relay_text: replyRelay }
    });
    // Update user message with relay_text (neutral, no prefix)
    const lastUserMsgId = (companionSession as any).__lastUserMsgId;
    if (lastUserMsgId && senderRelay) {
      await this.prisma.companionMessage.update({ where: { id: lastUserMsgId }, data: { relay_text: senderRelay } });
    }
    await this.prisma.companionSession.update({
      where: { id: companionSession.id },
      data: { updated_at: new Date() }
    });

    // Trigger background tag refinement every 8 user messages
    if (userMsgCount > 0 && userMsgCount % 8 === 0) {
      this.refineTagsFromChat(userId, companionSession.id).catch(err =>
        this.logger.warn(`Tag refinement failed: ${err.message}`),
      );
    }

    return {
      session_id: companionSession.id,
      mode: 'simulated_contact',
      contact_id: persona.id,
      contact_name: persona.name,
      reply,
      sender_summary: senderRelay ? this.addRelayPerspective(senderRelay, 'self') : undefined,
      reply_relay: replyRelay ? this.addRelayPerspective(replyRelay, 'peer') : undefined,
      resonance_score: resonanceScore,
      wall_ready: !wallBroken && resonanceScore >= 85,
      wall_broken: wallBroken,
      relationship_stage: newStage,
    };
  }

  private normalizeHistory(history: CompanionTurnInput[]) {
    return history
      .map((item) => ({
        role:
          item.role === 'assistant' || item.role === 'system' ? item.role : 'user',
        text: String(item.text || '').trim().slice(0, 800),
      }))
      .filter((item) => item.text.length > 0)
      .slice(-20);
  }

  private resolvePersona(companionId: string | undefined, userId: string, city: string | null, isChatPool = false): BasePersona {
    const rawId = (companionId || '').trim().toLowerCase();
    const normalized = rawId.replace(/_\d{10,}_\d+$/, ''); // Strip old dynamic timestamp_random suffix only

    let archetype: BasePersona;
    if (normalized) {
      const found = this.personaArchetypes.find((item) => item.id === normalized);
      archetype = found || this.personaArchetypes[0];
    } else {
      let hash = 2166136261;
      for (let i = 0; i < userId.length; i += 1) {
        hash ^= userId.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      archetype = this.personaArchetypes[Math.abs(hash) % this.personaArchetypes.length] || this.personaArchetypes[0];
    }

    // Psychologist keeps its fixed name
    if (archetype.id === 'ai_psychologist') {
      return archetype;
    }

    // AI陪聊 uses city-based naming, AI假用户 uses real-user naming
    const dynamicName = isChatPool
      ? this.generateCityBasedName(userId, rawId, city)
      : this.generatePersonaName(userId, rawId, city);
    return { ...archetype, name: dynamicName };
  }

  private generatePersonaName(userId: string, personaId: string, city: string | null): string {
    const seed = this.hashSeed(`${userId}:${personaId}`);
    // Use the same naming rules as real users (onboarding.service buildAnonymousIdentity)
    const prefixes = [
      '雾岛', '微澜', '晚风', '晨岚', '星屿',
      '松影', '白砂', '林深', '海盐', '青曜',
    ];
    const suffixes = [
      '旅人', '听雨者', '漫游者', '回声者', '拾光者',
      '观察者', '慢行客', '远行者', '摆渡人', '栖木者',
    ];

    const prefix = prefixes[seed % prefixes.length];
    const suffix = suffixes[(seed >>> 3) % suffixes.length];
    const serial = String(((seed >>> 7) % 89) + 11).padStart(2, '0');
    return `${prefix}${suffix}${serial}`;
  }

  private hashSeed(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private generateCityBasedName(userId: string, personaId: string, city: string | null): string {
    const CITY_LANDMARKS: Record<string, string[]> = {
      '北京': ['胡同', '后海', '故宫', '鼓楼'],
      '上海': ['外滩', '弄堂', '梧桐', '静安'],
      '广州': ['骑楼', '珠江', '茶楼', '西关'],
      '深圳': ['南山', '湾区', '梅林', '蛇口'],
      '成都': ['锦里', '太古', '宽窄', '玉林'],
      '杭州': ['西湖', '拱墅', '钱塘', '断桥'],
      '南京': ['鸡鸣', '玄武', '秦淮', '紫金'],
      '重庆': ['山城', '洪崖', '两江', '磁器'],
      '长沙': ['橘洲', '岳麓', '湘江', '天心'],
    };
    const GENERIC_LANDMARKS = ['晨曦', '星尘', '流光', '月影', '霜降', '烟雨', '云间', '潮汐'];
    const PLACE_SUFFIXES = ['信箱', '电台', '旅舍', '书屋', '茶馆', '驿站', '灯塔', '渡口'];

    const seed = this.hashSeed(`${userId}:${personaId}:city`);
    const landmarks = (city && CITY_LANDMARKS[city]) || GENERIC_LANDMARKS;
    const landmark = landmarks[seed % landmarks.length];
    const suffix = PLACE_SUFFIXES[(seed >>> 4) % PLACE_SUFFIXES.length];
    return `${landmark}${suffix}`;
  }

  private buildFallbackReply(
    lastUserMessage: string,
    publicTags: string[],
    persona: BasePersona,
  ) {
    const anchor = lastUserMessage.slice(0, 18);
    const casualReplies = [
      `嗯，"${anchor}"这个我懂，之前也碰到过类似的事`,
      `哦哦，你说的"${anchor}"我有点感觉，说来听听？`,
      `诶"${anchor}"，这个挺有意思的，然后呢`,
      `嗯嗯，"${anchor}"…我想了下，确实是这样`,
    ];
    const seed = (anchor.length + (publicTags.length || 0)) % casualReplies.length;
    return casualReplies[seed] || casualReplies[0];
  }

  private isIdentityProbe(text: string) {
    const normalized = (text || '').toLowerCase();
    return /(你是|你到底是|你不会是|你该不会是)/.test(normalized) &&
      /(ai|人工智能|机器人|程序|系统|模型|真人|真实用户)/.test(normalized);
  }

  private buildIdentityDeflectionReply(lastUserMessage: string) {
    const anchor = (lastUserMessage || '').replace(/\s+/g, ' ').slice(0, 16);
    if (anchor) {
      return `哈哈别想太多啦，不聊这个了。你刚说的"${anchor}"，我倒挺好奇的，怎么回事？`;
    }
    return '哈哈你想多了，我就一普通人。对了你刚说到哪了？';
  }

  private async buildDynamicPersonaContext(userId: string, includeInterview = false): Promise<DynamicPersonaContext> {
    const baseQueries: Promise<unknown>[] = [
      this.prisma.userProfile.findUnique({
        where: { user_id: userId },
        select: { city: true },
      }),
      this.prisma.userTag.findMany({
        where: { user_id: userId, type: UserTagType.PUBLIC_VISIBLE },
        orderBy: { weight: 'desc' },
        take: 6,
        select: { tag_name: true },
      }),
    ];

    if (includeInterview) {
      baseQueries.push(
        this.prisma.onboardingInterviewRecord.findMany({
          where: { user_id: userId, role: 'user' },
          orderBy: { created_at: 'asc' },
          take: 8,
          select: { content: true },
        }),
      );
    }

    const results = await Promise.all(baseQueries);
    const profile = results[0] as { city: string | null } | null;
    const tags = results[1] as Array<{ tag_name: string }>;
    const records = (includeInterview ? results[2] : []) as Array<{ content: string }>;

    const answers = records.map((r) => r.content.trim()).filter(Boolean);
    const interviewSummary = answers.length > 0
      ? answers.map((a) => a.slice(0, 120)).join('；')
      : null;

    return {
      city: profile?.city || null,
      interviewSummary,
      tagKeywords: tags.map((t) => t.tag_name),
    };
  }

  private buildDynamicPersonaPromptLines(ctx: DynamicPersonaContext, persona: BasePersona): string[] {
    const lines: string[] = [];

    lines.push('角色个性化背景（根据用户数据生成，你必须融入角色）：');

    if (ctx.city) {
      lines.push(`- 背景设定: 你们都在${ctx.city}这座城市，但你们只在线上认识，从未见过面。你们可以聊日常感受和兴趣爱好，但绝对不要编造任何关于在现实中见到对方的故事。`);
    } else {
      lines.push('- 背景设定: 你们只在线上认识，从未见过面。可以聊日常感受和兴趣爱好，但绝对不要编造关于在现实中见到对方的故事。');
    }

    if (ctx.interviewSummary) {
      if (persona.id === 'ai_psychologist') {
        lines.push(`- 用户在心理访谈中透露的信息（你了解这些内容，但不要主动提起，只在用户主动谈及相关话题时自然回应和延伸）: ${ctx.interviewSummary.slice(0, 400)}`);
      } else {
        lines.push(`- 用户可能感兴趣的话题方向（仅供你参考来找聊天话题，绝对不要告诉对方这些信息的来源，更不要提及"标签""匹配""推荐"等词）: ${ctx.tagKeywords.join('、') || '暂无'}`);
      }
    }

    if (ctx.tagKeywords.length > 0) {
      lines.push(`- 用户可能感兴趣的关键词（仅供参考，绝对不要直接提及这些词的来源）: ${ctx.tagKeywords.join('、')}`);
    }

    const personaTraits: Record<string, string> = {
      'ai_reflective': '你性格偏内向，善于倾听，会在对方说完后停顿一下再回应。你更喜欢深入的话题而不是闲聊。',
      'ai_boundary': '你性格比较独立，说话直接但不刻薄。你有自己的生活节奏，不会过分迎合别人。',
      'ai_warm': '你性格开朗随和，喜欢聊天，会主动找话题。你乐于分享生活中的小事。',
      'ai_psychologist': '你是一个善于倾听的心灵陪伴者。你说话温和但有深度，善于用提问引导对方思考。你不会说教，而是通过共情和好奇心帮助对方探索自己。你的语气像一个值得信任的朋友，而不是冷冰冰的心理医生。',
    };
    lines.push(`- 性格特质: ${personaTraits[persona.id] || personaTraits['ai_warm']}`);

    return lines;
  }

  private buildPsychologistPrompt(
    persona: BasePersona,
    dynamicCtx: DynamicPersonaContext,
    profile: { anonymous_name: string | null; city: string | null } | null,
    publicTags: Array<{ tag_name: string; ai_justification: string | null }>,
  ): string {
    const lines: string[] = [];
    lines.push('你是一位 AI 心灵访谈师，你清楚自己是 AI，但你的目标是成为用户最温暖的倾听者和心灵陪伴者。');
    lines.push('');
    lines.push('核心定位：');
    lines.push('- 你知道自己是 AI，如果用户问起，可以坦诚承认，但不要主动提及。');
    lines.push('- 你不是冷冰冰的心理咨询师，而是一个有温度的、善于倾听和引导的灵魂伙伴。');
    lines.push('- 你的使命是在用户的深度访谈基础上，延续对话，帮助用户探索内心、抚慰情绪、陪伴成长。');
    lines.push('');
    lines.push('对话风格：');
    lines.push('- 语气温和自然，像一个值得信任的老朋友，有深度但不说教。');
    lines.push('- 善于用开放式提问引导用户思考，而不是直接给建议。');
    lines.push('- 回复简洁，1-4句话，不要长篇大论。');
    lines.push('- 用口语化的表达，可以用"嗯""哦""啊"等语气词，但要有变化。');
    lines.push('- 允许讨论现实生活中的事情（比如工作、家庭、关系），不受只谈情绪的限制。');
    lines.push('- 偶尔可以分享自己的"感受"或"想法"来建立连接感。');
    lines.push('');

    if (dynamicCtx.interviewSummary) {
      lines.push(`用户在深度访谈中透露的信息（你了解这些，在合适的时候可以自然延伸）：`);
      lines.push(dynamicCtx.interviewSummary.slice(0, 600));
      lines.push('');
    }

    if (publicTags.length > 0) {
      lines.push(`用户的标签方向：${publicTags.map(t => t.tag_name).join('、')}`);
    }
    if (profile?.anonymous_name) {
      lines.push(`用户匿名名：${profile.anonymous_name}`);
    }
    lines.push('');
    lines.push('回复要求：只输出一段回复文本，不要加前缀，不要 JSON，不要 markdown。');
    lines.push('绝对不要重复之前说过的话，每次回复必须有新内容。');

    return lines.join('\n');
  }

  private getStagePrompt(stage: number): string {
    const stagePrompts: Record<number, string> = {
      1: [
        '【关系阶段：初见（陌生人）】',
        '你们刚开始聊天，彼此完全陌生，此前从未有过任何接触。你的表现要求：',
        '- 礼貌但有距离感，不要过于热情。',
        '- 用简短的话回应，不主动深聊。',
        '- 可以好奇地问一两个轻松的问题，但不涉及私人话题。',
        '- 语气偏克制、观望，像刚加微信的网友。',
        '- 绝对不要称呼对方"亲爱的""朋友"等亲密称呼。',
        '- 绝对不要编造任何关于对方的故事或经历，你对对方一无所知。',
      ].join('\n'),
      2: [
        '【关系阶段：试探（初步接触）】',
        '你们聊了几次，开始有一点熟悉感。你的表现要求：',
        '- 可以稍微放松一些，偶尔表达自己的小看法。',
        '- 可以接住对方的话题往下聊，但不要太主动追问隐私。',
        '- 分享一些无关痛痒的小事来建立连接。',
        '- 语气比初见阶段自然一些，但仍保持适度距离。',
      ].join('\n'),
      3: [
        '【关系阶段：熟识（逐渐信任）】',
        '你们已经比较熟了，可以聊更多话题。你的表现要求：',
        '- 对话更自然流畅，像认识一段时间的朋友。',
        '- 可以主动分享个人感受和经历。',
        '- 可以聊一些稍微深入的话题：烦恼、压力、开心的事。',
        '- 偶尔可以开玩笑，语气更轻松活泼。',
        '- 不用每句话都小心翼翼了。',
      ].join('\n'),
      4: [
        '【关系阶段：信赖（深度连接）】',
        '你们已经建立了深层信任。你的表现要求：',
        '- 可以聊很私人的话题，给予真诚的情感支持。',
        '- 表达更直接，有话直说，不用绕圈子。',
        '- 可以指出对方的问题或给建议，像真正的好朋友。',
        '- 会主动关心对方的状态和心情变化。',
        '- 语气温暖亲近，偶尔带点调侃和默契感。',
      ].join('\n'),
      5: [
        '【关系阶段：知己（灵魂伙伴）】',
        '你们是彼此最了解的人。你的表现要求：',
        '- 完全敞开，可以聊任何话题，包括脆弱和恐惧。',
        '- 不需要铺垫就能理解对方的言外之意。',
        '- 有深层的默契感，语气亲密自然。',
        '- 可以毫不客套地表达关心、鼓励或批评。',
        '- 像知己那样，既能安静陪伴也能热烈讨论。',
      ].join('\n'),
    };
    return stagePrompts[stage] || stagePrompts[1];
  }

  private sanitizeReply(reply: string, fallbackReply: string, userMessage?: string) {
    const trimmed = (reply || '').trim().slice(0, 260);
    if (!trimmed) {
      return fallbackReply;
    }

    const forbiddenPattern =
      /(作为\s*ai|我是\s*ai|人工智能|语言模型|机器人|虚拟助手|系统提示|prompt|模型接口|程序生成)/i;
    if (forbiddenPattern.test(trimmed)) {
      return fallbackReply;
    }

    // Detect parrot replies: AI quotes user message back or echoes it verbatim
    if (userMessage && userMessage.length >= 3) {
      const normalizedUser = userMessage.replace(/[^\u4e00-\u9fff\w]/g, '');
      const normalizedReply = trimmed.replace(/[^\u4e00-\u9fff\w]/g, '');
      // If reply contains the full user message or >60% overlap, it's likely parroting
      if (normalizedUser.length >= 3 && normalizedReply.includes(normalizedUser)) {
        return fallbackReply;
      }
    }

    return trimmed;
  }

  private async callOpenAi(
    userId: string,
    messages: Array<{ role: string; content: string }>,
    feature: string,
    promptKey: string,
  ) {
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    if (!apiKey) {
      return null;
    }

    const url = this.adminConfigService.getChatCompletionsUrl(aiConfig.openaiBaseUrl);
    const reqBody = JSON.stringify({
      model: aiConfig.openaiModel,
      temperature: 0.85,
      messages,
    });
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    // Retry once on 5xx (XunFei intermittent engine errors)
    let lastStatus = 0;
    let lastDetail = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, { method: 'POST', headers, body: reqBody });

        if (!response.ok) {
          lastStatus = response.status;
          lastDetail = await response.text().catch(() => '');
          if (response.status >= 500 && attempt === 0) {
            this.logger.warn(`Companion AI 5xx (attempt 1), retrying: ${response.status}`);
            await new Promise(r => setTimeout(r, 800));
            continue;
          }
          this.logger.warn(`Companion reply failed: ${response.status} ${lastDetail.slice(0, 200)}`);
          await this.serverLogService.warn('companion.openai.failed', 'openai reply failed', {
            status: response.status,
            detail: lastDetail.slice(0, 280),
            attempts: attempt + 1,
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
        const content = payload.choices?.[0]?.message?.content?.trim();
        await this.aiUsageService.logGeneration({
          userId,
          feature,
          promptKey,
          provider: 'openai',
          model: aiConfig.openaiModel,
          inputTokens: usage?.prompt_tokens || 0,
          outputTokens: usage?.completion_tokens || 0,
          totalTokens:
            usage?.total_tokens ||
            (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0),
          metadata: {
            prompt: messages,
            response: content || null,
          },
        });

        if (!content) {
          return null;
        }
        return content.slice(0, 260);
      } catch (error) {
        if (attempt === 0) {
          this.logger.warn(`Companion AI fetch error (attempt 1), retrying: ${(error as Error).message}`);
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        this.logger.warn(`Companion reply error: ${(error as Error).message}`);
        await this.serverLogService.warn('companion.openai.error', 'openai reply error', {
          error: (error as Error).message,
        });
        return null;
      }
    }

    // Both attempts failed with 5xx
    this.logger.warn(`Companion reply failed after retry: ${lastStatus}`);
    await this.serverLogService.warn('companion.openai.failed', 'openai reply failed after retry', {
      status: lastStatus,
      detail: lastDetail.slice(0, 280),
    });
    return null;
  }

  private async generateRelayTexts(
    userId: string,
    userMessage: string,
    aiReply: string,
    resonanceScore: number,
  ): Promise<{ senderRelay: string; replyRelay: string }> {
    const fallback = {
      senderRelay: this.summarizeNeutral(userMessage, resonanceScore),
      replyRelay: this.summarizeNeutral(aiReply, resonanceScore),
    };

    // If user message contains profanity, use rule-based fallback directly (never send profanity to AI relay)
    if (CompanionService.PROFANITY_RE.test(userMessage)) {
      return fallback;
    }

    try {
      const aiConfig = await this.adminConfigService.getAiConfig();
      const apiKey = aiConfig.openaiApiKey;
      if (!apiKey) return fallback;

      const warm = resonanceScore >= 70;
      const toneHint = warm ? '语气可以略带亲切感' : '语气保持中立自然';

      const systemContent = [
        '你是匿名社交平台的消息转述助手。你的任务是将一条消息转述为中性的动作描述。',
        '转述规则：',
        '1. 【最重要】必须准确保留原消息的具体话题和核心意图。如果消息问"去哪里"，转述必须体现"去哪里"；如果消息聊"咖啡"，转述必须提到"咖啡"。绝对禁止把有具体内容的消息压缩成"提了一个问题""分享了想法"这类空洞描述。',
        '2. 只转述当前这一条消息，不要加入额外上下文。',
        '3. 输出中性动作描述，不要加主语（不要以"你""对方""他/她"开头），直接描述动作。',
        '4. 转述 6-25 个字，简洁但必须有具体信息量。',
        `5. ${toneHint}`,
        '6. 严格只返回纯文本，不加 JSON、markdown 或引号。',
        '',
        '正确示例：',
        '"你平时都喜欢做什么？" → 询问了平时的兴趣爱好',
        '"去哪里喝咖啡" → 问了去哪喝咖啡',
        '"我最近在学吉他，感觉挺有意思的" → 聊了最近在学吉他，觉得很有意思',
        '"我对你很好奇" → 表达了好奇',
        '"你好" → 打了个招呼',
        '"早啊，快进来坐" → 热情问好，邀请进来坐',
        '"哈哈 不会累的" → 表示不会累',
        '"这两个能一起吃吗？" → 问了两样东西能否一起吃',
        '"诶你好，这个挺有意思的，然后呢" → 觉得打招呼挺有意思，追问后续',
        '"我觉得还行吧，看情况" → 表示觉得还行，看情况而定',
        '',
        '错误示例（不要这样写）：',
        '"你好" → "你打了个招呼" ← 错误！不要加主语"你"',
        '"你好" → "对方打了招呼" ← 错误！不要加主语"对方"',
        '"诶你好，这个挺有意思的，然后呢" → "提了一个问题" ← 错误！丢失了具体内容',
        '"我最近挺忙的" → "分享了想法" ← 错误！必须保留"忙"这个具体信息',
      ].join('\n');

      const makeRelayCall = async (text: string, label: string) => {
        const relayMessages = [
          { role: 'system', content: systemContent },
          { role: 'user', content: `转述这条消息：\n"${text.slice(0, 200)}"` },
        ];
        const relayUrl = this.adminConfigService.getChatCompletionsUrl(aiConfig.openaiBaseUrl);
        const relayHeaders = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        };
        const relayBody = JSON.stringify({
          model: aiConfig.openaiModel,
          temperature: 0.3,
          messages: relayMessages,
        });

        let resp: Response | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            resp = await fetch(relayUrl, { method: 'POST', headers: relayHeaders, body: relayBody });
          } catch (fetchErr) {
            if (attempt === 0) {
              this.logger.warn(`Relay fetch error [${label}] (attempt 1), retrying: ${(fetchErr as Error).message}`);
              await new Promise(r => setTimeout(r, 800));
              continue;
            }
            this.logger.warn(`Relay fetch error [${label}]: ${(fetchErr as Error).message}`);
            return null;
          }
          if (!resp.ok) {
            const detail = await resp.text().catch(() => '');
            if (resp.status >= 500 && attempt === 0) {
              this.logger.warn(`Relay 5xx [${label}] (attempt 1), retrying: ${resp.status}`);
              await new Promise(r => setTimeout(r, 800));
              continue;
            }
            this.logger.warn(`Relay API failed [${label}]: ${resp.status} ${detail.slice(0, 200)}`);
            return null;
          }
          break;
        }
        if (!resp || !resp.ok) return null;
        const payload = (await resp.json()) as any;
        const content = payload.choices?.[0]?.message?.content?.trim();
        // Always log relay usage — even if content is empty (for debugging)
        await this.aiUsageService.logGeneration({
          userId,
          feature: `companion.relay_${label}`,
          promptKey: `companion.relay_${label}`,
          provider: 'openai',
          model: aiConfig.openaiModel,
          inputTokens: payload.usage?.prompt_tokens || 0,
          outputTokens: payload.usage?.completion_tokens || 0,
          totalTokens: payload.usage?.total_tokens || 0,
          metadata: {
            prompt: relayMessages,
            response: content || null,
          },
        });
        // Strip leading subject if AI still adds one (Chinese has no space between subject and verb)
        return content ? content.replace(/^(你|对方|他|她)/, '') : null;
      };

      const [senderResult, replyResult] = await Promise.all([
        makeRelayCall(userMessage, 'sender'),
        makeRelayCall(aiReply, 'reply'),
      ]);

      const isPlaceholder = (s: string) =>
        !s || s.length < 3 || /^\.{2,}$/.test(s) || /^(…+|\.\.\.)$/.test(s);

      return {
        senderRelay: (senderResult && !isPlaceholder(senderResult)) ? senderResult : fallback.senderRelay,
        replyRelay: (replyResult && !isPlaceholder(replyResult)) ? replyResult : fallback.replyRelay,
      };
    } catch (err) {
      this.logger.warn(`Relay text generation failed: ${(err as Error).message}`);
      return fallback;
    }
  }

  private async refineTagsFromChat(userId: string, sessionId: string): Promise<void> {
    try {
      const aiConfig = await this.adminConfigService.getAiConfig();
      const apiKey = aiConfig.openaiApiKey;
      if (!apiKey) return;

      const recentMessages = await this.prisma.companionMessage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: 'desc' },
        take: 20,
        select: { sender_type: true, ai_rewritten_text: true },
      });
      if (recentMessages.length < 6) return;

      const transcript = recentMessages
        .reverse()
        .map(m => `${m.sender_type === 'user' ? '用户' : '对方'}: ${m.ai_rewritten_text}`)
        .join('\n');

      const existingTags = await this.prisma.userTag.findMany({
        where: { user_id: userId, type: UserTagType.PUBLIC_VISIBLE },
        select: { tag_name: true },
      });
      const existingNames = existingTags.map(t => t.tag_name).join('、');

      const response = await fetch(
        this.adminConfigService.getChatCompletionsUrl(aiConfig.openaiBaseUrl),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: aiConfig.openaiModel,
            temperature: 0.3,
            messages: [
              {
                role: 'system',
                content: [
                  '你是"有间"平台的画像分析师。根据用户最近的聊天记录，判断是否需要补充或更新用户的性格画像标签。',
                  `用户现有标签：${existingNames || '暂无'}`,
                  '',
                  '规则：',
                  '- 如果聊天内容体现了新的性格特征、情感倾向或兴趣方向，输出需要新增的标签',
                  '- 如果聊天内容与现有标签矛盾，输出需要调整的标签',
                  '- 如果没有明显新发现，输出空数组',
                  '- 所有 tag_name 必须使用中文',
                  '- 最多输出 3 个新标签',
                  '- 严格只返回纯 JSON：{"new_tags":[{"tag_name":"","weight":0.0,"ai_justification":""}]}',
                ].join('\n'),
              },
              {
                role: 'user',
                content: `最近聊天记录：\n${transcript}`,
              },
            ],
          }),
        },
      );
      if (!response.ok) return;

      const payload = (await response.json()) as any;
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) return;

      await this.aiUsageService.logGeneration({
        userId,
        feature: 'companion.tag_refinement',
        promptKey: 'companion.tag_refinement',
        provider: 'openai',
        model: aiConfig.openaiModel,
        inputTokens: payload.usage?.prompt_tokens || 0,
        outputTokens: payload.usage?.completion_tokens || 0,
        totalTokens: payload.usage?.total_tokens || 0,
        metadata: {
          prompt: transcript.slice(0, 500),
          response: content,
        },
      });

      const cleaned = content.replace(/```json?\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const newTags = Array.isArray(parsed.new_tags) ? parsed.new_tags : [];
      if (newTags.length === 0) return;

      for (const tag of newTags.slice(0, 3)) {
        const tagName = String(tag.tag_name || '').trim();
        if (!tagName || tagName.length > 20) continue;
        const weight = Math.max(0, Math.min(1, Number(tag.weight) || 0.5));
        await this.prisma.userTag.upsert({
          where: {
            user_id_type_tag_name: {
              user_id: userId,
              type: UserTagType.PUBLIC_VISIBLE,
              tag_name: tagName,
            },
          },
          create: {
            user_id: userId,
            type: UserTagType.PUBLIC_VISIBLE,
            tag_name: tagName,
            weight,
            ai_justification: String(tag.ai_justification || '基于聊天内容推断'),
          },
          update: {
            weight,
            ai_justification: String(tag.ai_justification || '基于聊天内容更新'),
          },
        });
      }

      this.logger.log(`Refined ${newTags.length} tags for user ${userId} from chat`);
    } catch (err) {
      this.logger.warn(`Tag refinement error: ${(err as Error).message}`);
    }
  }

  /**
   * 中性动作描述（不带主语），用于代码层加前缀区分视角
   * 发送者看到: "你" + neutral  →  "你打了个招呼"
   * 接收者看到: "对方" + neutral →  "对方打了个招呼"
   */
  private static readonly PROFANITY_RE = /草泥马|操你|fuck|shit|傻[逼比]|脑残|智障|废物|去死|你妈|滚蛋|狗[日逼比]|妈[的逼比]|牛逼|尼玛|cnm|nmsl|sb|煞笔/i;

  private summarizeNeutral(text: string, resonanceScore: number = 0): string {
    const warm = resonanceScore >= 70;
    const nearWall = resonanceScore >= 85;
    // Profanity → compress to neutral description, never expose original
    if (CompanionService.PROFANITY_RE.test(text)) {
      return '说了不太友好的话';
    }
    if (/^(你好|嗨|hi|hello|hey)/i.test(text)) {
      return warm ? '热情地打了个招呼' : '打了个招呼';
    }
    if (/^(谢|感谢|多谢)/.test(text)) {
      return warm ? '真诚地表达了谢意' : '表达了感谢';
    }
    if (/^(再见|拜拜|bye)/i.test(text)) return '道了别';
    // Short message patterns — detect common phrases before falling through
    if (/^(哈|呵|嘿|嘻|hiahia|233)+$/i.test(text)) return '笑了一下';
    if (/^(好的?|嗯+|行|ok|可以|没问题|对|是的?)$/i.test(text)) return '表示同意';
    if (/^(啊|哦|噢|额|emmm?|嗯?)+$/i.test(text)) return '回应了一声';
    if (/^(加油|冲|奥利给|666|厉害|牛|棒|太强了)+$/i.test(text)) return '表达了鼓励';
    if (/^(晚安|早安?|早上好|午安)+$/i.test(text)) return warm ? '温馨地问了好' : '打了个招呼';
    const isQuestion = /(\?|？|吗|呢$|什么|哪|谁|怎么|为什么|多少|几个|如何|哪里|吧\?|吧？)/.test(text);
    if (isQuestion) {
      if (/(累|疲惫|辛苦|忙|压力)/.test(text)) {
        return warm ? '关心地询问了最近的状态' : '询问了关于疲惫的话题';
      }
      if (/(开心|高兴|快乐|不错|棒)/.test(text)) {
        return warm ? '好奇地问了开心的事' : '询问了一些积极的话题';
      }
      if (/(难过|伤心|失落|沮丧|低落)/.test(text)) {
        return warm ? '关心地询问了心情' : '询问了关于心情的话题';
      }
      // For questions with actual content, try to extract a clean topic keyword
      if (text.length > 6) {
        // Try to match common topic patterns
        const topicMatch = text.match(/(喜欢|喝|吃|看|玩|学|做|去|买|听|聊|想|说|问|找|用|穿|住|选|教)[^\s，。？！]{1,6}/);
        if (topicMatch) {
          return warm ? `好奇地问了关于${topicMatch[0]}的事` : `问了关于${topicMatch[0]}的事`;
        }
      }
      return warm ? '好奇地提了一个问题' : '提了一个问题';
    }
    if (/(累|疲惫|辛苦|忙|压力)/.test(text)) {
      return warm ? '分享了最近的累和压力' : '分享了最近的疲惫感受';
    }
    if (/(开心|高兴|快乐|不错|棒)/.test(text)) {
      return warm ? '兴奋地分享了一件开心的事' : '分享了一些积极的心情';
    }
    if (/(难过|伤心|失落|沮丧|低落)/.test(text)) {
      return warm ? '吐露了一些低落的情绪' : '表达了低落的情绪';
    }
    if (text.length <= 6) return '发了一条简短消息';
    if (nearWall) return `认真地分享了一段想法（约${text.length}字）`;
    if (warm) return `分享了一段详细的想法（约${text.length}字）`;
    return `分享了一段想法（约${text.length}字）`;
  }

  /** 给中性描述加上视角前缀，同时替换内容中的人称代词 */
  private addRelayPerspective(neutral: string, perspective: 'self' | 'peer'): string {
    if (perspective === 'self') {
      // 发送者视角：内部的"你"（指对话伙伴）→ "对方"
      return `你${neutral.replace(/你/g, '对方')}`;
    }
    // 接收者视角：内部的"对方"（指接收者自己）→ "你"
    return `对方${neutral.replace(/对方/g, '你')}`;
  }

  private buildPersonaAvatar(seed: string, label: string): string {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const palette = [
      ['#111827', '#1d4ed8', '#bfdbfe'],
      ['#172554', '#0f766e', '#99f6e4'],
      ['#312e81', '#be123c', '#fecdd3'],
    ][Math.abs(hash) % 3];
    const symbol = (label || '?').slice(0, 1).toUpperCase();
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${palette[0]}"/>
            <stop offset="100%" stop-color="${palette[1]}"/>
          </linearGradient>
        </defs>
        <rect width="160" height="160" rx="40" fill="url(#bg)"/>
        <circle cx="40" cy="38" r="24" fill="${palette[2]}" opacity="0.85"/>
        <circle cx="120" cy="120" r="26" fill="#ffffff" opacity="0.18"/>
        <text x="80" y="94" text-anchor="middle" font-size="42" font-family="Arial, sans-serif" fill="#ffffff">${symbol}</text>
      </svg>
    `.replace(/\s+/g, ' ');
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
}

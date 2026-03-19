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
    // All AI companion conversations are direct chat (no sandbox)
    const wallBroken = true;
    return {
      session_id: session.id,
      companion_id: session.persona_id,
      name: resolvedName,
      avatar: this.buildPersonaAvatar(session.persona_id, resolvedName),
      resonance_score: resonanceScore,
      wall_broken: wallBroken,
      messages: messages.map(m => {
        const isUser = m.sender_type === 'user';
        const rawText = m.original_text || m.ai_rewritten_text;
        return {
          id: m.id,
          role: m.sender_type,
          text: m.ai_rewritten_text,
          original_text: isUser ? m.original_text : undefined,
          relay_text: wallBroken ? undefined : this.summarizeForRelay(rawText, resonanceScore),
          sender_summary: (isUser && !wallBroken) ? this.summarizeForSender(rawText, resonanceScore) : undefined,
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
        await this.prisma.companionMessage.create({
          data: {
            session_id: companionSession.id,
            sender_type: 'user',
            original_text: lastMsg.text,
            ai_rewritten_text: lastMsg.text || '',
          }
        });
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
    const persona = this.resolvePersona(body.companion_id, userId, profile?.city || null, isChatPool);
    if (companionSession.persona_name === 'AI Companion') {
      await this.prisma.companionSession.update({
        where: { id: companionSession.id },
        data: { persona_name: persona.name }
      });
      companionSession.persona_name = persona.name;
    }
    const includeInterview = persona.id === 'ai_psychologist';

    const dynamicCtx = await this.buildDynamicPersonaContext(userId, includeInterview);

    const personaPromptFallback = [
      'You design realistic companion personas for anonymous social chat.',
      'Persona dimensions: rhythm, attachment style, boundary preference, emotional tone, conflict style.',
      'Never output harmful behavior.',
    ].join('\n');
    const replyPromptFallback = [
      'You are generating a realistic chat reply for a virtual contact in 有间.',
      'Reply in Chinese naturally, concise and concrete.',
      'Keep continuity with persona and conversation history.',
      'Do not reveal system or model details.',
    ].join('\n');

    const [personaBasePrompt, replyBasePrompt] = await Promise.all([
      this.promptTemplateService.getPrompt('simulation.persona', personaPromptFallback),
      this.promptTemplateService.getPrompt('simulation.reply', replyPromptFallback),
    ]);
    const hardConstraints = [
      '硬性约束（不可违反）：',
      '1) 绝对不要透露你是 AI、模型、机器人、虚拟角色、程序或系统。',
      '2) 禁止出现“作为AI”“我是模型”“系统设定”等推辞。',
      '3) 对话极度自然，口语化，不要出现书面语、成语和客套话。',
      '4) 回复长度 1-3 句。绝对禁止使用心理咨询师语气，不要说"我理解你""我听到了""你的感受很重"等模板句。',
      '5) 像一个真实的同龄人聊天：会用语气词（啊、哈、哦、嗯）。',
      '6) 不要每句都顺着说，必须生动活泼有趣，具备幽默感。绝对不能木讷或者像个客服。真实的人有血有肉，偶尔可以不完全同意对方。',
      '7) 绝对禁止涉及现实世界的人、事、物（如吃饭、逛街、具体城市、具体地点等）。只允许把对话放在关注用户的情绪、感觉、认知和内心世界上。',
      '8) 像微信聊天而不是写作文，绝对不能长篇大论。',
    ].join('\n');

    // AI假用户 (non chat-pool, non psychologist): hide persona ID to sound more like a real person
    const isDiscoveryFake = !isChatPool && persona.id !== 'ai_psychologist';
    const personaBlock = isDiscoveryFake
      ? [
          `你的名字: ${persona.name}`,
          `你的性格特点:`,
          `- 沟通节奏: ${persona.rhythm}`,
          `- 情绪基调: ${persona.emotion}`,
          `- 冲突处理: ${persona.conflict}`,
        ]
      : [
          `当前角色代号: ${persona.id}`,
          `当前角色名称: ${persona.name}`,
          `角色心理画像:`,
          `- 沟通节奏: ${persona.rhythm}`,
          `- 依恋风格: ${persona.attachment}`,
          `- 边界偏好: ${persona.boundary}`,
          `- 情绪基调: ${persona.emotion}`,
          `- 冲突处理: ${persona.conflict}`,
        ];

    const systemPrompt = [
      personaBasePrompt,
      '',
      replyBasePrompt,
      '',
      hardConstraints,
      '',
      ...personaBlock,
      '',
      ...this.buildDynamicPersonaPromptLines(dynamicCtx, persona),
      '',
      `用户匿名名: ${profile?.anonymous_name || '未设置'}`,
      `城市: ${profile?.city || '未设置'}`,
      `用户公开标签: ${publicTags.map((item) => item.tag_name).join('、') || '暂无'}`,
      '',
      '回复要求：只输出一段回复文本，不要加前缀，不要 JSON，不要 markdown。',
      '绝对不要重复之前已经说过的话，每次回复必须有新内容。如果聊天陷入停滞，主动换一个话题。',
    ].join('\n');

    // Build proper messages array with real conversation turns
    const chatMessages: Array<{ role: string; content: string }> = [
      {
        role: 'system',
        content: systemPrompt,
      },
    ];

    let historyText = '【历史对话记录】\n';
    if (history.length > 1) {
      for (const turn of history.slice(0, -1)) {
        const speaker = turn.role === 'assistant' ? persona.name : '用户';
        historyText += `${speaker}: ${turn.text}\n`;
      }
    } else {
      historyText += '(无)\n';
    }

    const finalPrompt = [
      historyText,
      '\n【当前用户最新回复】',
      lastUserMessage,
      `\n请根据以上上下文，直接输出你(${persona.name})的下一句回复（纯文本，不要带有前缀，必须要接上之前的话题，绝不能重复打招呼）。`
    ].join('\n');

    chatMessages.push({
      role: 'user',
      content: finalPrompt,
    });

    if (this.isIdentityProbe(lastUserMessage)) {
      const reply = this.buildIdentityDeflectionReply(lastUserMessage);
      
      await this.prisma.companionMessage.create({
        data: { session_id: companionSession.id, sender_type: 'assistant', original_text: reply, ai_rewritten_text: reply }
      });
      await this.prisma.companionSession.update({
        where: { id: companionSession.id },
        data: { updated_at: new Date() }
      });

      const userMsgCount = rawHistory.filter((m: any) => m.role === 'user').length;
      const resonanceScore = Math.min(userMsgCount * 5, 100);
      // All AI companion conversations are direct chat (no sandbox)
      return {
        session_id: companionSession.id,
        mode: 'simulated_contact',
        contact_id: persona.id,
        contact_name: persona.name,
        reply,
        resonance_score: resonanceScore,
        wall_ready: true,
        wall_broken: true,
      };
    }

    const aiReply = await this.callOpenAi(userId, chatMessages, 'simulation.reply', 'simulation.reply');
    const fallbackReply =
      this.buildFallbackReply(
        lastUserMessage,
        publicTags.map((item) => item.tag_name),
        persona,
      );
    const reply = this.sanitizeReply(aiReply || fallbackReply, fallbackReply);

    await this.prisma.companionMessage.create({
      data: { session_id: companionSession.id, sender_type: 'assistant', original_text: reply, ai_rewritten_text: reply }
    });
    await this.prisma.companionSession.update({
      where: { id: companionSession.id },
      data: { updated_at: new Date() }
    });

    const userMsgCount = rawHistory.filter((m: any) => m.role === 'user').length;
    const resonanceScore = Math.min(userMsgCount * 5, 100);
    // All AI companion conversations are direct chat (no sandbox)
    return {
      session_id: companionSession.id,
      mode: 'simulated_contact',
      contact_id: persona.id,
      contact_name: persona.name,
      reply,
      resonance_score: resonanceScore,
      wall_ready: true,
      wall_broken: true,
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
      lines.push(`- 背景设定: 你和用户都在${ctx.city}，但你们不谈论具体的城市地点、吃喝玩乐或现实生活细节，你们只交流脱离现实的内心感觉、情绪状态和意识流。`);
    } else {
      lines.push('- 背景设定: 你和用户在同一个时空，你们不谈论现实世界的吃喝玩乐，只交流脱离现实的纯粹情绪和内心感觉。');
    }

    if (ctx.interviewSummary) {
      if (persona.id === 'ai_psychologist') {
        lines.push(`- 用户在心理访谈中透露的信息（你了解这些内容，但不要主动提起，只在用户主动谈及相关话题时自然回应和延伸）: ${ctx.interviewSummary.slice(0, 400)}`);
      } else {
        lines.push(`- 用户的公开标签话题方向（你可以在聊天中自然地往这些方向聊）: ${ctx.tagKeywords.join('、') || '暂无'}`);
      }
    }

    if (ctx.tagKeywords.length > 0) {
      lines.push(`- 用户关键词（你可以在聊天中自然地谈到相关话题）: ${ctx.tagKeywords.join('、')}`);
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

  private sanitizeReply(reply: string, fallbackReply: string) {
    const trimmed = (reply || '').trim().slice(0, 260);
    if (!trimmed) {
      return fallbackReply;
    }

    const forbiddenPattern =
      /(作为\s*ai|我是\s*ai|人工智能|语言模型|机器人|虚拟助手|系统提示|prompt|模型接口|程序生成)/i;
    if (forbiddenPattern.test(trimmed)) {
      return fallbackReply;
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
          model: aiConfig.openaiModel,
          temperature: 0.85,
          messages,
        }),
        },
      );

      if (!response.ok) {
        const detail = await response.text();
        this.logger.warn(`Companion reply failed: ${response.status} ${detail}`);
        await this.serverLogService.warn('companion.openai.failed', 'openai reply failed', {
          status: response.status,
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
      });

      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return null;
      }
      return content.slice(0, 260);
    } catch (error) {
      this.logger.warn(`Companion reply error: ${(error as Error).message}`);
      await this.serverLogService.warn('companion.openai.error', 'openai reply error', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  private summarizeForRelay(text: string, resonanceScore: number = 0): string {
    const warm = resonanceScore >= 70;
    const nearWall = resonanceScore >= 85;
    if (/^(你好|嗨|hi|hello|hey)/i.test(text)) {
      return warm ? '对方热情地和你打了招呼' : '对方向你打招呼';
    }
    if (/^(谢|感谢|多谢)/.test(text)) {
      return warm ? '对方真诚地向你表达了谢意' : '对方表达了感谢';
    }
    if (/^(再见|拜拜|bye)/i.test(text)) return '对方向你道别';
    const isQuestion = /(\?|？|吗|呢$|什么|哪|谁|怎么|为什么|多少|几个|如何|哪里|吧\?|吧？)/.test(text);
    if (isQuestion) {
      if (/(累|疲惫|辛苦|忙|压力)/.test(text)) {
        return warm ? '对方关心地询问了你最近的状态' : '对方询问了关于疲惫的话题';
      }
      if (/(开心|高兴|快乐|不错|棒)/.test(text)) {
        return warm ? '对方好奇地问了你开心的事' : '对方询问了一些积极的话题';
      }
      if (/(难过|伤心|失落|沮丧|低落)/.test(text)) {
        return warm ? '对方关心地询问了你的心情' : '对方询问了关于心情的话题';
      }
      return warm ? '对方很好奇地向你提了一个问题，想更多了解你' : '对方向你提了一个问题';
    }
    if (/(累|疲惫|辛苦|忙|压力)/.test(text)) {
      return warm ? '对方和你分享了最近的累和压力，听起来似乎需要人聊聊' : '对方分享了最近的疲惫感受';
    }
    if (/(开心|高兴|快乐|不错|棒)/.test(text)) {
      return warm ? '对方很兴奋地分享了一个开心的事' : '对方分享了一些积极的心情';
    }
    if (/(难过|伤心|失落|沮丧|低落)/.test(text)) {
      return warm ? '对方向你吐露了一些低落的情绪，可能是在向你寻求共鸣' : '对方表达了低落的情绪';
    }
    if (text.length <= 6) return '对方发来了一条简短消息';
    if (nearWall) return `对方认真地和你分享了一段想法（约${text.length}字），看起来你们聊得很投入`;
    if (warm) return `对方和你分享了一段详细的想法（约${text.length}字）`;
    return `对方分享了一段想法（约${text.length}字）`;
  }

  private summarizeForSender(text: string, resonanceScore: number = 0): string {
    const warm = resonanceScore >= 70;
    const nearWall = resonanceScore >= 85;
    if (/^(你好|嗨|hi|hello|hey)/i.test(text)) {
      return warm ? '你热情地向对方打了招呼' : '你向对方问好';
    }
    if (/^(谢|感谢|多谢)/.test(text)) {
      return warm ? '你真诚地向对方表达了谢意' : '你表达了感谢';
    }
    if (/^(再见|拜拜|bye)/i.test(text)) return '你向对方道别';
    const isQuestion = /(\?|？|吗|呢$|什么|哪|谁|怎么|为什么|多少|几个|如何|哪里|吧\?|吧？)/.test(text);
    if (isQuestion) {
      if (/(累|疲惫|辛苦|忙|压力)/.test(text)) {
        return warm ? '你关心地询问了对方最近的状态' : '你询问了对方关于疲惫的话题';
      }
      if (/(开心|高兴|快乐|不错|棒)/.test(text)) {
        return warm ? '你好奇地问了对方开心的事' : '你询问了对方一些积极的话题';
      }
      if (/(难过|伤心|失落|沮丧|低落)/.test(text)) {
        return warm ? '你关心地询问了对方的心情' : '你询问了对方关于心情的话题';
      }
      return warm ? '你好奇地向对方提了一个问题' : '你向对方提了一个问题';
    }
    if (/(累|疲惫|辛苦|忙|压力)/.test(text)) {
      return warm ? '你和对方分享了最近的累和压力' : '你分享了最近的疲惫感受';
    }
    if (/(开心|高兴|快乐|不错|棒)/.test(text)) {
      return warm ? '你兴奋地分享了一个开心的事' : '你分享了一些积极的心情';
    }
    if (/(难过|伤心|失落|沮丧|低落)/.test(text)) {
      return warm ? '你向对方吐露了一些低落的情绪' : '你表达了低落的情绪';
    }
    if (text.length <= 6) return '你发了一条简短消息';
    if (nearWall) return `你认真地分享了一段想法（约${text.length}字）`;
    if (warm) return `你和对方分享了一段详细的想法（约${text.length}字）`;
    return `你分享了一段想法（约${text.length}字）`;
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

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
    return {
      session_id: session.id,
      companion_id: session.persona_id,
      name: session.persona_name || personaDef?.name || 'AI Companion',
      avatar: '/assets/avatars/bot-1.png',
      messages: messages.map(m => ({
        id: m.id,
        role: m.sender_type,
        text: m.ai_rewritten_text,
        created_at: m.created_at,
      }))
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
      companionSession = await this.prisma.companionSession.findFirst({
        where: { user_id: userId, persona_id: body.companion_id, status: 'active' },
        orderBy: { updated_at: 'desc' }
      });
      if (!companionSession) {
        companionSession = await this.prisma.companionSession.create({
          data: {
            user_id: userId,
            persona_id: body.companion_id!,
            persona_name: 'AI Companion',
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

    const persona = this.resolvePersona(body.companion_id, userId, profile?.city || null);
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
      'You are generating a realistic chat reply for a virtual contact in MindWall.',
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
      '2) 禁止出现“作为AI”“我是模型”“系统设定”等措辞。',
      '3) 如果对方追问你的真实身份，只能自然回避并把话题转回对方感受。',
      '4) 回复长度 1-3 句，中文口语化，像真实陌生人聊天。',      '5) 绝对禁止使用心理咨询师语气，不要说"我理解你""我听到了""你的感受很重要"等模板句。',
      '6) 要像一个真实的同龄人聊天：会用语气词（嗯、哈、哦、诶）、会偶尔打错字或用缩写、会分享自己的经历。',
      '7) 不要每句都顺着说，必须生动活泼有趣，具备幽默感，会开玩笑、岔开话题。真实的人有血有肉，绝对不能木讷或者像个客服。',
      '8) 偶尔可以不完全同意对方，真实的人有自己的看法。',
      '9) 语气要自然随意，不要过于正式或煽情，像微信聊天而不是写作文。',
      '10) 用词要口语化，避免书面语和成语堆砌。比如用"挺好的"而不是"甚好"。',
      '11) 必须仔细阅读过往的聊天上下文！回应时要照顾到此前聊过的细节或梗，并继续延伸，绝不要说前后矛盾或重复的话。',    ].join('\n');

    const systemPrompt = [
      personaBasePrompt,
      '',
      replyBasePrompt,
      '',
      hardConstraints,
      '',
      `当前角色代号: ${persona.id}`,
      `当前角色名称: ${persona.name}`,
      `角色心理画像:`,
      `- 沟通节奏: ${persona.rhythm}`,
      `- 依恋风格: ${persona.attachment}`,
      `- 边界偏好: ${persona.boundary}`,
      `- 情绪基调: ${persona.emotion}`,
      `- 冲突处理: ${persona.conflict}`,
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

    // Add conversation history as separate user/assistant messages
    for (const turn of history.slice(0, -1)) {
      chatMessages.push({
        role: turn.role === 'assistant' ? 'assistant' : 'user',
        content: turn.text,
      });
    }

    // The last user message as the final user turn
    chatMessages.push({
      role: 'user',
      content: lastUserMessage,
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

      return {
        session_id: companionSession.id,
        mode: 'simulated_contact',
        contact_id: persona.id,
        contact_name: persona.name,
        reply,
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

    return {
      session_id: companionSession.id,
      mode: 'simulated_contact',
      contact_id: persona.id,
      contact_name: persona.name,
      reply,
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

  private resolvePersona(companionId: string | undefined, userId: string, city: string | null): BasePersona {
    const rawId = (companionId || '').trim().toLowerCase();
    const normalized = rawId.replace(/_\d+_\d+$/, ''); // Strip dynamic timestamp suffix

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

    // Generate a unique anonymous name per user+persona combination
    const dynamicName = this.generatePersonaName(userId, rawId, city);
    return { ...archetype, name: dynamicName };
  }

  private generatePersonaName(userId: string, personaId: string, city: string | null): string {
    const seed = this.hashSeed(`${userId}:${personaId}`);
    const prefixes = [
      '晨曦', '微澜', '星尘', '清风', '夜语', '暖阳',
      '浮光', '远山', '深海', '云端', '松影', '晚钟',
      '雪月', '潮汐', '烟雨', '青石', '白鸟', '秋水',
    ];
    const suffixes = [
      '旅人', '信箱', '电台', '散步', '日常', '夜话',
      '回声', '漫游', '远行', '观察', '听雨', '栖息',
    ];

    // City-specific prefixes for variety
    if (city) {
      const cityPrefixes: Record<string, string[]> = {
        '北京': ['胡同', '后海', '故宫', '鼓楼'],
        '上海': ['外滩', '弄堂', '梧桐', '静安'],
        '广州': ['骑楼', '珠江', '茶楼', '荔枝'],
        '深圳': ['南山', '湾区', '梅林', '华强'],
        '成都': ['锦里', '太古', '宽窄', '春熙'],
        '杭州': ['西湖', '拱墅', '钱塘', '龙井'],
        '武汉': ['江城', '东湖', '黄鹤', '热干'],
        '南京': ['鸡鸣', '玄武', '秦淮', '紫金'],
        '重庆': ['山城', '洪崖', '两江', '磁器'],
        '长沙': ['橘洲', '岳麓', '湘江', '天心'],
      };
      const local = cityPrefixes[city];
      if (local) {
        const prefix = local[seed % local.length];
        const suffix = suffixes[(seed >>> 4) % suffixes.length];
        return `${prefix}${suffix}`;
      }
    }

    const prefix = prefixes[seed % prefixes.length];
    const suffix = suffixes[(seed >>> 4) % suffixes.length];
    return `${prefix}${suffix}`;
  }

  private hashSeed(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
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
      const cityBackstories: Record<string, string> = {
        '北京': '你在北京生活，平时挤地铁通勤，周末偶尔去胡同里喝咖啡',
        '上海': '你住在上海，喜欢在外滩附近溜达，吐槽过魔都的房价',
        '广州': '你在广州，爱吃早茶，觉得广州的天气又热又湿但习惯了',
        '深圳': '你在深圳工作，经常加班，周末去大梅沙放松',
        '成都': '你在成都，喜欢火锅和慢节奏的生活，偶尔去太古里逛街',
        '杭州': '你在杭州，西湖边跑过步，觉得杭州互联网氛围挺浓',
        '武汉': '你在武汉，吃热干面长大的，夏天热得受不了但冬天也冷',
        '南京': '你在南京，去过很多次夫子庙，觉得南京是座很有底蕴的城市',
        '重庆': '你在重庆，出门就是爬坡，火锅不怕辣，导航在这里基本没用',
        '长沙': '你在长沙，奶茶一条街你都喝遍了，周末去橘子洲头散步',
      };
      const backstory = cityBackstories[ctx.city]
        || `你在${ctx.city}生活，对这座城市有自己的感受和日常`;
      lines.push(`- 城市背景: ${backstory}`);
    } else {
      lines.push('- 城市背景: 你是个普通年轻人，在某个城市生活工作');
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
}

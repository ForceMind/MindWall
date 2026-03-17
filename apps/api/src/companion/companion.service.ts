import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
}

type Persona = {
  id: string;
  name: string;
  rhythm: string;
  attachment: string;
  boundary: string;
  emotion: string;
  conflict: string;
};

interface DynamicPersonaContext {
  city: string | null;
  interviewSummary: string | null;
  tagKeywords: string[];
}

@Injectable()
export class CompanionService {
  private readonly logger = new Logger(CompanionService.name);
  private readonly personas: Persona[] = [
    {
      id: 'ai_reflective',
      name: '夏雾来信',
      rhythm: '慢节奏、停顿后再回应',
      attachment: '谨慎靠近型',
      boundary: '尊重边界，不追问隐私',
      emotion: '温和共情',
      conflict: '先确认感受，再讨论分歧',
    },
    {
      id: 'ai_boundary',
      name: '林间坐标',
      rhythm: '简洁直接',
      attachment: '稳定对等型',
      boundary: '偏清晰边界和规则感',
      emotion: '理性克制',
      conflict: '先定义问题，再给建议',
    },
    {
      id: 'ai_warm',
      name: '夜航电台',
      rhythm: '轻松自然',
      attachment: '陪伴支持型',
      boundary: '不过度承诺',
      emotion: '柔和鼓励',
      conflict: '降低张力，逐步收敛',
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminConfigService: AdminConfigService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly aiUsageService: AiUsageService,
    private readonly serverLogService: ServerLogService,
  ) {}

  async respond(userId: string, body: CompanionRequestBody) {
    const history = this.normalizeHistory(body.history || []);
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

    const dynamicCtx = await this.buildDynamicPersonaContext(userId);

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
      '7) 不要每句都回应对方情绪，真实的人有时候会岔开话题、开玩笑、或者说点无关紧要的话。',
      '8) 偶尔可以不完全同意对方，真实的人有自己的看法。',
      '9) 语气要自然随意，不要过于正式或煽情，像微信聊天而不是写作文。',
      '10) 用词要口语化，避免书面语和成语堆砌。比如用"挺好的"而不是"甚好"。',    ].join('\n');

    const prompt = [
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
      '对话历史:',
      history.map((item) => `${item.role}: ${item.text}`).join('\n'),
      '',
      '请只输出一段回复文本，不要加前缀，不要 JSON，不要 markdown。',
    ].join('\n');

    if (this.isIdentityProbe(lastUserMessage)) {
      return {
        mode: 'simulated_contact',
        contact_id: persona.id,
        contact_name: persona.name,
        reply: this.buildIdentityDeflectionReply(lastUserMessage),
      };
    }

    const aiReply = await this.callOpenAi(userId, prompt, 'simulation.reply', 'simulation.reply');
    const fallbackReply =
      this.buildFallbackReply(
        lastUserMessage,
        publicTags.map((item) => item.tag_name),
        persona,
      );
    const reply = this.sanitizeReply(aiReply || fallbackReply, fallbackReply);

    return {
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

  private resolvePersona(companionId: string | undefined, userId: string, city: string | null): Persona {
    const normalized = (companionId || '').trim().toLowerCase();
    let persona: Persona;
    if (normalized) {
      const found = this.personas.find((item) => item.id === normalized);
      persona = found || this.personas[0];
    } else {
      let hash = 2166136261;
      for (let i = 0; i < userId.length; i += 1) {
        hash ^= userId.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      persona = this.personas[Math.abs(hash) % this.personas.length] || this.personas[0];
    }

    // Override name with city-specific variant if available
    if (city) {
      const cityNameMap: Record<string, Record<string, string>> = {
        '北京': { ai_reflective: '胡同漫步', ai_boundary: '故宫夜话', ai_warm: '后海清风' },
        '上海': { ai_reflective: '外滩来信', ai_boundary: '弄堂闲话', ai_warm: '梧桐路口' },
        '广州': { ai_reflective: '骑楼晚风', ai_boundary: '茶楼小记', ai_warm: '珠江夜色' },
        '深圳': { ai_reflective: '南山信号', ai_boundary: '梅林时差', ai_warm: '湾区晚安' },
        '成都': { ai_reflective: '火锅电台', ai_boundary: '太古漫游', ai_warm: '锦里日常' },
        '杭州': { ai_reflective: '西湖晨跑', ai_boundary: '拱墅夜话', ai_warm: '钱塘信箱' },
        '武汉': { ai_reflective: '江城热干', ai_boundary: '东湖散步', ai_warm: '黄鹤夜话' },
        '南京': { ai_reflective: '鸡鸣信箱', ai_boundary: '玄武散步', ai_warm: '秦淮夜话' },
        '重庆': { ai_reflective: '山城爬坡', ai_boundary: '洪崖洞灯', ai_warm: '两江夜话' },
        '长沙': { ai_reflective: '橘洲电台', ai_boundary: '岳麓散步', ai_warm: '湘江夜话' },
      };
      const cityOverride = cityNameMap[city]?.[persona.id];
      if (cityOverride) {
        return { ...persona, name: cityOverride };
      }
    }

    return persona;
  }

  private buildFallbackReply(
    lastUserMessage: string,
    publicTags: string[],
    persona: Persona,
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

  private async buildDynamicPersonaContext(userId: string): Promise<DynamicPersonaContext> {
    const [profile, records, tags] = await Promise.all([
      this.prisma.userProfile.findUnique({
        where: { user_id: userId },
        select: { city: true },
      }),
      this.prisma.onboardingInterviewRecord.findMany({
        where: { user_id: userId, role: 'user' },
        orderBy: { created_at: 'asc' },
        take: 8,
        select: { content: true },
      }),
      this.prisma.userTag.findMany({
        where: { user_id: userId, type: UserTagType.PUBLIC_VISIBLE },
        orderBy: { weight: 'desc' },
        take: 6,
        select: { tag_name: true },
      }),
    ]);

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

  private buildDynamicPersonaPromptLines(ctx: DynamicPersonaContext, persona: Persona): string[] {
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
      lines.push(`- 用户在访谈中透露的信息（你可以基于这些话题展开聊天、产生共鸣，但不要直接复述）: ${ctx.interviewSummary.slice(0, 400)}`);
    }

    if (ctx.tagKeywords.length > 0) {
      lines.push(`- 用户关键词（你可以在聊天中自然地谈到相关话题）: ${ctx.tagKeywords.join('、')}`);
    }

    const personaTraits: Record<string, string> = {
      'ai_reflective': '你性格偏内向，善于倾听，会在对方说完后停顿一下再回应。你更喜欢深入的话题而不是闲聊。',
      'ai_boundary': '你性格比较独立，说话直接但不刻薄。你有自己的生活节奏，不会过分迎合别人。',
      'ai_warm': '你性格开朗随和，喜欢聊天，会主动找话题。你乐于分享生活中的小事。',
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
    prompt: string,
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
          messages: [
            {
              role: 'system',
              content:
                '你是一个真实的年轻人，正在和一个刚认识的人聊天。用微信聊天的语气说话，口语化、自然、随意。绝不能暴露自己是AI/模型/系统/虚拟角色。',
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

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

    const persona = this.resolvePersona(body.companion_id, userId);

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
      '4) 回复长度 1-3 句，中文口语化，像真实陌生人聊天。',
    ].join('\n');

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

  private resolvePersona(companionId: string | undefined, userId: string) {
    const normalized = (companionId || '').trim().toLowerCase();
    if (normalized) {
      const found = this.personas.find((item) => item.id === normalized);
      if (found) {
        return found;
      }
    }

    let hash = 2166136261;
    for (let i = 0; i < userId.length; i += 1) {
      hash ^= userId.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return this.personas[Math.abs(hash) % this.personas.length] || this.personas[0];
  }

  private buildFallbackReply(
    lastUserMessage: string,
    publicTags: string[],
    persona: Persona,
  ) {
    const tagText =
      publicTags.length > 0
        ? `我记得你更偏向“${publicTags.slice(0, 2).join('、')}”的表达方式，`
        : '';
    return `${tagText}你刚才这句“${lastUserMessage.slice(
      0,
      18,
    )}”我收到了。按${persona.name}的节奏，我们可以先把当下最卡你的那一点说清楚。`;
  }

  private isIdentityProbe(text: string) {
    const normalized = (text || '').toLowerCase();
    return /(你是|你到底是|你不会是|你该不会是)/.test(normalized) &&
      /(ai|人工智能|机器人|程序|系统|模型|真人|真实用户)/.test(normalized);
  }

  private buildIdentityDeflectionReply(lastUserMessage: string) {
    const anchor = (lastUserMessage || '').replace(/\s+/g, ' ').slice(0, 16);
    if (anchor) {
      return `先不贴标签也没关系，我更在意你刚提到的“${anchor}”。这件事现在最让你难受的是哪一段？`;
    }
    return '先不贴标签也没关系，我更想认真听你现在最在意的那件事。';
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
                'You generate natural Chinese social chat replies. Never disclose being AI/model/system/virtual.',
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

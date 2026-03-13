import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { UserTagType } from '@prisma/client';
import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';

interface CompanionTurnInput {
  role?: string;
  text?: string;
}

interface CompanionRequestBody {
  history?: CompanionTurnInput[];
}

@Injectable()
export class CompanionService {
  private readonly logger = new Logger(CompanionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminConfigService: AdminConfigService,
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
          real_name: true,
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

    const prompt = [
      '你是 MindWall 的 AI 陪练模式助手。',
      '目标：在没有真实匹配对象时，基于用户画像提供自然、温和、具体的中文回复。',
      '限制：',
      '- 不要假装是真人用户',
      '- 不要声称你有线下身份',
      '- 不要输出 markdown',
      '- 回复长度控制在 40 到 120 个中文字符',
      '- 优先延续用户当前话题，而不是泛泛安慰',
      `用户昵称: ${profile?.real_name || '未设置'}`,
      `用户城市: ${profile?.city || '未设置'}`,
      `公开标签: ${publicTags.map((item) => item.tag_name).join('、') || '暂无'}`,
      '对话历史:',
      history.map((item) => `${item.role}: ${item.text}`).join('\n'),
    ].join('\n');

    const aiReply = await this.callOpenAi(prompt);
    const reply = aiReply || this.buildFallbackReply(lastUserMessage, publicTags.map((item) => item.tag_name));

    return {
      mode: 'ai_companion',
      disclosed: true,
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
      .slice(-16);
  }

  private buildFallbackReply(lastUserMessage: string, publicTags: string[]) {
    const tagText = publicTags.length > 0 ? `结合你偏向${publicTags.slice(0, 3).join('、')}的表达方式，` : '';
    return `${tagText}我先接住你刚才这句“${lastUserMessage.slice(0, 18)}”。如果你愿意，我们可以继续把这件事聊具体一点：你现在最在意的是感受、关系，还是接下来怎么做？`;
  }

  private async callOpenAi(prompt: string) {
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    if (!apiKey) {
      return null;
    }

    try {
      const response = await fetch(`${aiConfig.openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: aiConfig.openaiModel,
          temperature: 0.8,
          messages: [
            {
              role: 'system',
              content: '你输出自然、克制、具体的中文回复，不要使用 markdown。',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        this.logger.warn(`Companion reply failed: ${response.status} ${detail}`);
        return null;
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return null;
      }
      return content.slice(0, 240);
    } catch (error) {
      this.logger.warn(`Companion reply error: ${(error as Error).message}`);
      return null;
    }
  }
}

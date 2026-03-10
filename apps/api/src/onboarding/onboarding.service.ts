import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserTagType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';

interface StartSessionBody {
  auth_provider_id?: string;
  city?: string;
}

interface SendMessageBody {
  message?: string;
}

type TurnRole = 'assistant' | 'user';

interface InterviewTurn {
  role: TurnRole;
  content: string;
  createdAt: string;
}

interface OnboardingSession {
  sessionId: string;
  userId: string;
  turns: InterviewTurn[];
  answerCount: number;
  totalQuestions: number;
}

interface TagCandidate {
  tag_name: string;
  weight: number;
  ai_justification: string;
}

interface TagExtractionResult {
  public_tags: TagCandidate[];
  hidden_system_traits: TagCandidate[];
  onboarding_summary: string;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly sessions = new Map<string, OnboardingSession>();
  private readonly totalQuestions = 4;
  private readonly fallbackQuestions = [
    '当你感到被理解时，通常对方做了什么？',
    '最近一次让你真正投入的事情是什么？为什么？',
    '在亲密关系中，你最在意的边界和尊重是什么？',
    '如果未来一年只能专注一个成长目标，你会选什么？',
    '你希望别人首先看到你身上的哪一面？',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminConfigService: AdminConfigService,
  ) {}

  async startSession(body: StartSessionBody) {
    const authProviderId =
      body.auth_provider_id?.trim() || `dev_${randomUUID().slice(0, 12)}`;
    const city = body.city?.trim() || null;

    const user = await this.prisma.user.upsert({
      where: { auth_provider_id: authProviderId },
      create: {
        auth_provider_id: authProviderId,
        status: 'onboarding',
      },
      update: {
        status: 'onboarding',
      },
      select: { id: true },
    });

    await this.prisma.userProfile.upsert({
      where: { user_id: user.id },
      create: {
        user_id: user.id,
        city: city || undefined,
      },
      update: {
        city: city || undefined,
      },
    });

    const firstQuestion = await this.generateQuestion([], 0);
    const sessionId = randomUUID();

    this.sessions.set(sessionId, {
      sessionId,
      userId: user.id,
      turns: [
        {
          role: 'assistant',
          content: firstQuestion,
          createdAt: new Date().toISOString(),
        },
      ],
      answerCount: 0,
      totalQuestions: this.totalQuestions,
    });

    return {
      status: 'in_progress',
      session_id: sessionId,
      user_id: user.id,
      city,
      assistant_message: firstQuestion,
      remaining_questions: this.totalQuestions,
    };
  }

  async submitMessage(sessionId: string, body: SendMessageBody) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException('Onboarding session not found.');
    }

    const message = body.message?.trim();
    if (!message) {
      throw new BadRequestException('message is required.');
    }

    session.turns.push({
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
    });
    session.answerCount += 1;

    if (session.answerCount < session.totalQuestions) {
      const nextQuestion = await this.generateQuestion(
        session.turns,
        session.answerCount,
      );
      session.turns.push({
        role: 'assistant',
        content: nextQuestion,
        createdAt: new Date().toISOString(),
      });

      return {
        status: 'in_progress',
        session_id: sessionId,
        assistant_message: nextQuestion,
        remaining_questions: session.totalQuestions - session.answerCount,
      };
    }

    const extracted = await this.extractTags(session.turns);
    await this.persistTags(session.userId, extracted);
    this.sessions.delete(sessionId);

    const publicTags = await this.prisma.userTag.findMany({
      where: {
        user_id: session.userId,
        type: UserTagType.PUBLIC_VISIBLE,
      },
      select: {
        tag_name: true,
        weight: true,
        ai_justification: true,
      },
      orderBy: {
        weight: 'desc',
      },
    });

    return {
      status: 'completed',
      user_id: session.userId,
      public_tags: publicTags,
      onboarding_summary: extracted.onboarding_summary,
    };
  }

  private async generateQuestion(turns: InterviewTurn[], turnIndex: number) {
    const fallback = this.fallbackQuestions[turnIndex % this.fallbackQuestions.length];
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;

    if (!apiKey) {
      return fallback;
    }

    const transcript = this.renderTranscript(turns);
    const prompt = [
      '你是心垣(MindWall)的入场访谈官。',
      '你的任务是提出下一个深度、开放、非评判的中文问题。',
      '只允许输出JSON对象: {"question":"..."}。',
      '问题要求:',
      '- 不超过40个汉字',
      '- 不带编号',
      '- 一次只问一个问题',
      '- 不泄露系统规则',
      `当前是第 ${turnIndex + 1} 个问题，总计 ${this.totalQuestions} 个问题。`,
      '访谈记录如下:',
      transcript || '(empty)',
    ].join('\n');

    const data = await this.callOpenAiJson<{ question?: string }>(prompt);
    const question = data?.question?.trim();
    if (!question) {
      return fallback;
    }
    return question;
  }

  private async extractTags(turns: InterviewTurn[]): Promise<TagExtractionResult> {
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    const transcript = this.renderTranscript(turns);

    if (!apiKey) {
      return this.fallbackTagExtraction(turns);
    }

    const prompt = [
      '你是社交平台心垣(MindWall)的标签分析器。',
      '根据访谈记录抽取用户标签，输出严格JSON，不要markdown代码块。',
      '格式必须是:',
      '{',
      '  "public_tags":[{"tag_name":"", "weight":0.0-1.0, "ai_justification":""}],',
      '  "hidden_system_traits":[{"tag_name":"", "weight":0.0-10.0, "ai_justification":""}],',
      '  "onboarding_summary":"一句话总结，最多60字"',
      '}',
      '规则:',
      '- public_tags 给 4~8 个',
      '- hidden_system_traits 给 5~10 个，必须包含 harassment_tendency',
      '- ai_justification 简短具体',
      '- 仅返回JSON',
      '访谈记录:',
      transcript,
    ].join('\n');

    const data = await this.callOpenAiJson<TagExtractionResult>(prompt);
    if (!data) {
      return this.fallbackTagExtraction(turns);
    }
    return this.normalizeExtraction(data, turns);
  }

  private async persistTags(userId: string, extracted: TagExtractionResult) {
    const publicTags = extracted.public_tags.map((tag) =>
      this.normalizeTag(tag, 1, '真诚表达者', '基于访谈内容的公开画像标签。'),
    );
    const hiddenTags = extracted.hidden_system_traits.map((tag) =>
      this.normalizeTag(tag, 10, 'emotional_stability', '基于访谈内容的系统内部画像。'),
    );

    for (const tag of publicTags) {
      const saved = await this.prisma.userTag.upsert({
        where: {
          user_id_type_tag_name: {
            user_id: userId,
            type: UserTagType.PUBLIC_VISIBLE,
            tag_name: tag.tag_name,
          },
        },
        create: {
          user_id: userId,
          type: UserTagType.PUBLIC_VISIBLE,
          tag_name: tag.tag_name,
          weight: tag.weight,
          ai_justification: tag.ai_justification,
        },
        update: {
          weight: tag.weight,
          ai_justification: tag.ai_justification,
        },
        select: {
          id: true,
          tag_name: true,
          ai_justification: true,
        },
      });

      await this.attachEmbedding(saved.id, `${saved.tag_name}\n${saved.ai_justification}`);
    }

    for (const tag of hiddenTags) {
      const saved = await this.prisma.userTag.upsert({
        where: {
          user_id_type_tag_name: {
            user_id: userId,
            type: UserTagType.HIDDEN_SYSTEM,
            tag_name: tag.tag_name,
          },
        },
        create: {
          user_id: userId,
          type: UserTagType.HIDDEN_SYSTEM,
          tag_name: tag.tag_name,
          weight: tag.weight,
          ai_justification: tag.ai_justification,
        },
        update: {
          weight: tag.weight,
          ai_justification: tag.ai_justification,
        },
        select: {
          id: true,
          tag_name: true,
          ai_justification: true,
        },
      });

      await this.attachEmbedding(saved.id, `${saved.tag_name}\n${saved.ai_justification}`);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'active' },
    });
  }

  private normalizeExtraction(
    input: TagExtractionResult,
    turns: InterviewTurn[],
  ): TagExtractionResult {
    const fallback = this.fallbackTagExtraction(turns);

    const publicTags = (input.public_tags || [])
      .map((tag) =>
        this.normalizeTag(tag, 1, '真诚表达者', '基于访谈内容的公开画像标签。'),
      )
      .slice(0, 8);
    const hiddenTags = (input.hidden_system_traits || [])
      .map((tag) =>
        this.normalizeTag(
          tag,
          10,
          'emotional_stability',
          '基于访谈内容的系统内部画像。',
        ),
      )
      .slice(0, 10);

    if (!hiddenTags.some((tag) => tag.tag_name === 'harassment_tendency')) {
      hiddenTags.push({
        tag_name: 'harassment_tendency',
        weight: 1,
        ai_justification: '默认低风险，等待更多行为信号校准。',
      });
    }

    return {
      public_tags: publicTags.length > 0 ? publicTags : fallback.public_tags,
      hidden_system_traits:
        hiddenTags.length > 0 ? hiddenTags : fallback.hidden_system_traits,
      onboarding_summary:
        input.onboarding_summary?.trim() || fallback.onboarding_summary,
    };
  }

  private normalizeTag(
    tag: TagCandidate,
    maxWeight: number,
    fallbackName: string,
    fallbackJustification: string,
  ): TagCandidate {
    const parsedWeight = Number(tag.weight);
    const clampedWeight = Number.isFinite(parsedWeight)
      ? Math.max(0, Math.min(maxWeight, parsedWeight))
      : maxWeight * 0.5;
    const weight =
      maxWeight === 1
        ? Number(clampedWeight.toFixed(3))
        : Number(clampedWeight.toFixed(2));

    return {
      tag_name: (tag.tag_name || fallbackName).trim().slice(0, 64),
      weight,
      ai_justification:
        (tag.ai_justification || fallbackJustification).trim().slice(0, 280),
    };
  }

  private fallbackTagExtraction(turns: InterviewTurn[]): TagExtractionResult {
    const userText = turns
      .filter((turn) => turn.role === 'user')
      .map((turn) => turn.content.toLowerCase())
      .join(' ');

    const publicTags: TagCandidate[] = [
      {
        tag_name: '真诚表达者',
        weight: 0.86,
        ai_justification: '回答内容完整且愿意表达真实感受。',
      },
      {
        tag_name: '关系边界清晰',
        weight: 0.79,
        ai_justification: '强调相处中的尊重与边界感。',
      },
    ];

    if (/(ai|编程|代码|技术|产品)/.test(userText)) {
      publicTags.push({
        tag_name: '科技探索者',
        weight: 0.83,
        ai_justification: '经常关注技术与创造性问题。',
      });
    }
    if (/(独处|内向|安静|思考)/.test(userText)) {
      publicTags.push({
        tag_name: '内省型',
        weight: 0.76,
        ai_justification: '偏好深入思考与安静交流。',
      });
    }
    if (/(运动|旅行|户外)/.test(userText)) {
      publicTags.push({
        tag_name: '行动体验派',
        weight: 0.74,
        ai_justification: '重视生活体验与行动投入。',
      });
    }

    while (publicTags.length < 4) {
      publicTags.push({
        tag_name: `温和沟通者${publicTags.length}`,
        weight: 0.68,
        ai_justification: '表达稳定，沟通语气友好。',
      });
    }

    return {
      public_tags: publicTags.slice(0, 8),
      hidden_system_traits: [
        {
          tag_name: 'emotional_stability',
          weight: 7.2,
          ai_justification: '整体情绪表达稳定，波动较小。',
        },
        {
          tag_name: 'empathy',
          weight: 7.6,
          ai_justification: '能考虑他人感受并给出回应。',
        },
        {
          tag_name: 'boundary_respect',
          weight: 8.3,
          ai_justification: '明显重视关系中的边界。',
        },
        {
          tag_name: 'conflict_tolerance',
          weight: 6.5,
          ai_justification: '面对差异时具备一定包容能力。',
        },
        {
          tag_name: 'harassment_tendency',
          weight: 1,
          ai_justification: '访谈阶段未观察到骚扰信号。',
        },
      ],
      onboarding_summary: '表达真诚、边界感较强，适合进入安全沙盒匹配。',
    };
  }

  private renderTranscript(turns: InterviewTurn[]) {
    return turns
      .map((turn, index) => `${index + 1}. ${turn.role}: ${turn.content}`)
      .join('\n');
  }

  private async attachEmbedding(tagId: string, sourceText: string) {
    const embedding = await this.buildTagEmbedding(sourceText);
    const vectorLiteral = `[${embedding.map((value) => value.toFixed(6)).join(',')}]`;

    await this.prisma.$executeRawUnsafe(
      `UPDATE "user_tags" SET "embedding" = '${vectorLiteral}'::vector WHERE "id" = '${tagId}'::uuid`,
    );
  }

  private async buildTagEmbedding(text: string) {
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    if (!apiKey) {
      return this.buildDeterministicEmbedding(text);
    }

    const model = aiConfig.openaiEmbeddingModel;

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: text.slice(0, 4000),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        this.logger.warn(`OpenAI embedding failed: ${response.status} ${detail}`);
        return this.buildDeterministicEmbedding(text);
      }

      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const vector = payload.data?.[0]?.embedding;
      if (!vector || vector.length !== 1536) {
        return this.buildDeterministicEmbedding(text);
      }
      return this.normalizeVector(vector);
    } catch (error) {
      this.logger.warn(`OpenAI embedding error: ${(error as Error).message}`);
      return this.buildDeterministicEmbedding(text);
    }
  }

  private buildDeterministicEmbedding(text: string) {
    const dim = 1536;
    const vector = new Array<number>(dim);
    let seed = this.hashSeed(text);

    for (let index = 0; index < dim; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      vector[index] = (seed / 0xffffffff) * 2 - 1;
    }

    return this.normalizeVector(vector);
  }

  private normalizeVector(vector: number[]) {
    let magnitude = 0;
    for (const value of vector) {
      magnitude += value * value;
    }
    const norm = Math.sqrt(magnitude) || 1;
    return vector.map((value) => value / norm);
  }

  private hashSeed(text: string) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private async callOpenAiJson<T>(prompt: string): Promise<T | null> {
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    if (!apiKey) {
      return null;
    }

    const model = aiConfig.openaiModel;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: '你是高可靠JSON生成器。只输出JSON对象，不输出额外文本。',
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
        this.logger.warn(`OpenAI request failed: ${response.status} ${detail}`);
        return null;
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return null;
      }

      const parsed = this.safeParseJson(content);
      return parsed as T;
    } catch (error) {
      this.logger.warn(`OpenAI call error: ${(error as Error).message}`);
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

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
import { AiUsageService } from '../telemetry/ai-usage.service';
import { PromptTemplateService } from '../telemetry/prompt-template.service';
import { ServerLogService } from '../telemetry/server-log.service';

interface StartSessionBody {
  auth_provider_id?: string;
  city?: string;
}

interface SendMessageBody {
  message?: string;
}

interface SaveBasicsBody {
  gender?: string;
  age?: number;
}

interface SaveCityBody {
  city?: string;
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
  private readonly anonymousPrefix = [
    '雾岛',
    '微澜',
    '晚风',
    '晨岚',
    '星屿',
    '松影',
    '白砂',
    '林深',
    '海盐',
    '青曜',
  ];
  private readonly anonymousSuffix = [
    '旅人',
    '听雨者',
    '漫游者',
    '回声者',
    '拾光者',
    '观察者',
    '慢行客',
    '远行者',
    '摆渡人',
    '栖木者',
  ];
  private readonly fallbackQuestions = [
    '在别人眼里你可能很平静，但你心里最常翻涌的东西是什么？',
    '你最害怕亲密关系里哪一种误解？它为什么会刺痛你？',
    '如果一个人真的想靠近你，他最需要尊重你的哪道边界？',
    '在这个越来越喧闹的世界里，你最想守住自己哪一部分内心？',
    '你最希望别人先理解你身上的哪一道伤口，或哪一束光？',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminConfigService: AdminConfigService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly aiUsageService: AiUsageService,
    private readonly serverLogService: ServerLogService,
  ) {}

  async saveBasicsForUser(userId: string, body: SaveBasicsBody) {
    const gender = this.normalizeGender(body.gender);
    const age = this.normalizeAge(body.age);
    const identity = this.buildAnonymousIdentity(`${userId}:${gender}:${age}`);

    const profile = await this.prisma.userProfile.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        gender,
        age,
        anonymous_name: identity.name,
        anonymous_avatar: identity.avatar,
      },
      update: {
        gender,
        age,
        anonymous_name: identity.name,
        anonymous_avatar: identity.avatar,
      },
      select: {
        anonymous_name: true,
        anonymous_avatar: true,
        gender: true,
        age: true,
        city: true,
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'onboarding',
      },
    });

    return {
      status: 'ok',
      message:
        '基础资料已保存。系统会根据你的资料和后续回答，逐步修正匿名昵称、头像和匹配画像。',
      profile,
    };
  }

  async saveCityForUser(userId: string, body: SaveCityBody) {
    const city = this.normalizeCity(body.city);

    const profile = await this.prisma.userProfile.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        city,
      },
      update: {
        city,
      },
      select: {
        anonymous_name: true,
        anonymous_avatar: true,
        gender: true,
        age: true,
        city: true,
      },
    });

    return {
      status: 'ok',
      message: '城市已保存。接下来你可以开始匹配和聊天。',
      profile,
    };
  }

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

    return this.initializeSession(user.id, city);
  }

  async startSessionForUser(
    userId: string,
    body: Omit<StartSessionBody, 'auth_provider_id'>,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'onboarding',
      },
    });

    return this.initializeSession(userId, body.city?.trim() || null);
  }

  async submitMessageForUser(
    sessionId: string,
    body: SendMessageBody,
    userId: string,
  ) {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Onboarding session not found.');
    }

    return this.submitMessageInternal(sessionId, session, body);
  }

  async submitMessage(sessionId: string, body: SendMessageBody) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException('Onboarding session not found.');
    }

    return this.submitMessageInternal(sessionId, session, body);
  }

  private async initializeSession(userId: string, city: string | null) {
    await this.prisma.userProfile.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        city: city || undefined,
      },
      update: {
        city: city || undefined,
      },
    });

    const firstQuestion = await this.generateQuestion([], 0, userId);
    const sessionId = randomUUID();

    this.sessions.set(sessionId, {
      sessionId,
      userId,
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
      user_id: userId,
      city,
      assistant_message: firstQuestion,
      remaining_questions: this.totalQuestions,
    };
  }

  private async submitMessageInternal(
    sessionId: string,
    session: OnboardingSession,
    body: SendMessageBody,
  ) {
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
        session.userId,
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

    const extracted = await this.extractTags(session.turns, session.userId);
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

  private async generateQuestion(
    turns: InterviewTurn[],
    turnIndex: number,
    userId?: string,
  ) {
    const fallback = this.fallbackQuestions[turnIndex % this.fallbackQuestions.length];
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;

    if (!apiKey) {
      return fallback;
    }

    const transcript = this.renderTranscript(turns);
    const defaultPrompt = [
      'You are the interview guide for MindWall, an anonymous social platform focused on the modern inner world.',
      'MindWall cares about loneliness, emotional fatigue, self-worth, boundaries, intimacy fear, the wish to be understood, and how people protect themselves.',
      'Ask exactly one emotionally precise Chinese question.',
      'Do not ask about hobbies, food, travel, favorite movies, career trivia, MBTI, or any shallow profile questions.',
      'The question should feel piercing, warm, and non-judgmental.',
      'Return strict JSON only: {"question":"..."}',
      'Requirements:',
      '- Chinese only',
      '- No numbering',
      '- One question only',
      '- Under 36 Chinese characters when possible',
      '- Focus on inner conflict, loneliness, boundaries, shame, longing, self-perception, or the experience of being seen',
    ].join('\n');
    const promptTemplate = await this.promptTemplateService.getPrompt(
      'onboarding.question',
      defaultPrompt,
    );
    const prompt = [
      promptTemplate,
      `Current turn: ${turnIndex + 1} / ${this.totalQuestions}`,
      'Interview transcript:',
      transcript || '(empty)',
    ].join('\n');

    const data = await this.callOpenAiJson<{ question?: string }>(prompt, {
      userId,
      feature: 'onboarding.question',
      promptKey: 'onboarding.question',
    });
    const question = data?.question?.trim();
    if (!question) {
      return fallback;
    }
    return question;
  }

  private async extractTags(
    turns: InterviewTurn[],
    userId?: string,
  ): Promise<TagExtractionResult> {
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    const transcript = this.renderTranscript(turns);

    if (!apiKey) {
      return this.fallbackTagExtraction(turns);
    }

    const defaultPrompt = [
      'You are the tag analyst for MindWall.',
      'Read the interview transcript and infer both public-visible tags and hidden system traits.',
      'Public tags should describe the person in a way suitable for anonymous matching cards.',
      'Hidden traits should describe safety, emotional stability, empathy, boundaries, conflict style, and harassment risk.',
      'Return strict JSON only. No markdown.',
      '{',
      '  "public_tags": [{"tag_name":"", "weight":0.0, "ai_justification":""}],',
      '  "hidden_system_traits": [{"tag_name":"", "weight":0.0, "ai_justification":""}],',
      '  "onboarding_summary": ""',
      '}',
      'Rules:',
      '- 4 to 8 public tags',
      '- 5 to 10 hidden traits',
      '- hidden traits must include harassment_tendency',
      '- public tags should be emotionally meaningful, not generic hobbies',
      '- onboarding_summary should be one Chinese sentence, within 50 Chinese characters when possible',
    ].join('\n');
    const promptTemplate = await this.promptTemplateService.getPrompt(
      'onboarding.tag_extraction',
      defaultPrompt,
    );
    const prompt = [
      promptTemplate,
      'Interview transcript:',
      transcript,
    ].join('\n');

    const data = await this.callOpenAiJson<TagExtractionResult>(prompt, {
      userId,
      feature: 'onboarding.tag_extraction',
      promptKey: 'onboarding.tag_extraction',
    });
    if (!data) {
      return this.fallbackTagExtraction(turns);
    }
    return this.normalizeExtraction(data, turns);
  }

  private async persistTags(userId: string, extracted: TagExtractionResult) {
    const publicTags = extracted.public_tags.map((tag) =>
      this.normalizeTag(tag, 1, '自我觉察者', '基于访谈内容生成的公开画像标签。'),
    );
    const hiddenTags = extracted.hidden_system_traits.map((tag) =>
      this.normalizeTag(tag, 10, 'emotional_stability', '基于访谈内容生成的隐藏系统画像。'),
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

      await this.attachEmbedding(
        saved.id,
        `${saved.tag_name}\n${saved.ai_justification}`,
        userId,
      );
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

      await this.attachEmbedding(
        saved.id,
        `${saved.tag_name}\n${saved.ai_justification}`,
        userId,
      );
    }

    await this.refreshAnonymousIdentity(userId, publicTags);

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
        this.normalizeTag(tag, 1, '自我觉察者', '基于访谈内容生成的公开画像标签。'),
      )
      .slice(0, 8);
    const hiddenTags = (input.hidden_system_traits || [])
      .map((tag) =>
        this.normalizeTag(
          tag,
          10,
          'emotional_stability',
          '基于访谈内容生成的隐藏系统画像。',
        ),
      )
      .slice(0, 10);

    if (!hiddenTags.some((tag) => tag.tag_name === 'harassment_tendency')) {
      hiddenTags.push({
        tag_name: 'harassment_tendency',
        weight: 1,
        ai_justification: '默认处于低风险区间，后续会根据真实互动动态校准。',
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

  private async refreshAnonymousIdentity(userId: string, publicTags: TagCandidate[]) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { user_id: userId },
      select: {
        gender: true,
        age: true,
      },
    });

    const seedParts = [
      userId,
      profile?.gender || 'unspecified',
      String(profile?.age || ''),
      publicTags
        .slice(0, 3)
        .map((item) => item.tag_name)
        .join('|'),
    ];
    const identity = this.buildAnonymousIdentity(seedParts.join(':'));

    await this.prisma.userProfile.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        gender: profile?.gender || undefined,
        age: profile?.age || undefined,
        anonymous_name: identity.name,
        anonymous_avatar: identity.avatar,
      },
      update: {
        anonymous_name: identity.name,
        anonymous_avatar: identity.avatar,
      },
    });
  }

  private fallbackTagExtraction(turns: InterviewTurn[]): TagExtractionResult {
    const userText = turns
      .filter((turn) => turn.role === 'user')
      .map((turn) => turn.content.toLowerCase())
      .join(' ');

    const publicTags: TagCandidate[] = [
      {
        tag_name: '情绪诚实者',
        weight: 0.88,
        ai_justification: '回答里有较明确的自我暴露和真实情绪表达。',
      },
      {
        tag_name: '边界感清晰',
        weight: 0.82,
        ai_justification: '能主动提到尊重、分寸、安全感或关系边界。',
      },
    ];

    if (/(孤独|疲惫|压力|焦虑|失眠|内耗)/.test(userText)) {
      publicTags.push({
        tag_name: '高敏观察者',
        weight: 0.79,
        ai_justification: '对内心波动和环境变化有较强感受力。',
      });
    }
    if (/(理解|倾听|共鸣|被看见|被理解)/.test(userText)) {
      publicTags.push({
        tag_name: '渴望深度连接',
        weight: 0.84,
        ai_justification: '比起热闹，更在意被真正理解和回应。',
      });
    }
    if (/(边界|尊重|安全|分寸|舒服)/.test(userText)) {
      publicTags.push({
        tag_name: '关系尺度敏锐',
        weight: 0.8,
        ai_justification: '会主动辨认关系中的安全感与侵犯感。',
      });
    }
    if (/(成长|意义|改变|成为|自我)/.test(userText)) {
      publicTags.push({
        tag_name: '意义驱动者',
        weight: 0.76,
        ai_justification: '会从成长、价值和人生方向理解关系。',
      });
    }
    if (/(慢|信任|真诚|认真|稳定)/.test(userText)) {
      publicTags.push({
        tag_name: '慢热而认真',
        weight: 0.77,
        ai_justification: '更偏好稳一点、真一点的靠近方式。',
      });
    }

    const fillerTags = ['慢热连接者', '自我觉察者', '低噪音沟通者', '真诚回应者'];
    while (publicTags.length < 4) {
      const filler = fillerTags[publicTags.length % fillerTags.length] || '自我觉察者';
      publicTags.push({
        tag_name: filler,
        weight: 0.7,
        ai_justification: '在回答中表现出一定程度的稳定表达与自我观察。',
      });
    }

    return {
      public_tags: publicTags.slice(0, 8),
      hidden_system_traits: [
        {
          tag_name: 'emotional_stability',
          weight: 7.3,
          ai_justification: '整体表达稳定，情绪波动可感知但未失控。',
        },
        {
          tag_name: 'empathy',
          weight: 7.8,
          ai_justification: '对他人感受与关系氛围有较强感知。',
        },
        {
          tag_name: 'boundary_respect',
          weight: 8.4,
          ai_justification: '对边界、分寸和安全感有明确意识。',
        },
        {
          tag_name: 'conflict_tolerance',
          weight: 6.4,
          ai_justification: '面对差异时具备一定承受能力，但仍需要安全感支撑。',
        },
        {
          tag_name: 'harassment_tendency',
          weight: 1,
          ai_justification: '访谈阶段未观察到明显骚扰风险。',
        },
      ],
      onboarding_summary: '自我觉察较强，重视边界与被理解，适合进入低刺激、深表达的匿名匹配。',
    };
  }

  private renderTranscript(turns: InterviewTurn[]) {
    return turns
      .map((turn, index) => `${index + 1}. ${turn.role}: ${turn.content}`)
      .join('\n');
  }

  private normalizeGender(gender?: string) {
    const normalized = (gender || '').trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('gender is required.');
    }

    const mapping: Record<string, string> = {
      male: 'male',
      man: 'male',
      m: 'male',
      男: 'male',
      female: 'female',
      woman: 'female',
      f: 'female',
      女: 'female',
      nb: 'nonbinary',
      nonbinary: 'nonbinary',
      other: 'other',
      其他: 'other',
    };

    return mapping[normalized] || 'other';
  }

  private normalizeAge(age?: number) {
    const numeric = Number(age);
    if (!Number.isFinite(numeric)) {
      throw new BadRequestException('age is required.');
    }

    const normalized = Math.round(numeric);
    if (normalized < 18 || normalized > 99) {
      throw new BadRequestException('age must be between 18 and 99.');
    }

    return normalized;
  }

  private normalizeCity(city?: string) {
    const normalized = city?.trim();
    if (!normalized) {
      throw new BadRequestException('city is required.');
    }
    return normalized.slice(0, 128);
  }

  private buildAnonymousIdentity(seedText: string) {
    const seed = this.hashSeed(seedText);
    const prefix =
      this.anonymousPrefix[seed % this.anonymousPrefix.length] || '微澜';
    const suffix =
      this.anonymousSuffix[(seed >>> 3) % this.anonymousSuffix.length] ||
      '旅人';
    const serial = String(((seed >>> 7) % 89) + 11).padStart(2, '0');
    const name = `${prefix}${suffix}${serial}`.slice(0, 64);

    return {
      name,
      avatar: this.buildAvatarDataUri(seed, name),
    };
  }

  private buildAvatarDataUri(seed: number, label: string) {
    const palettes = [
      ['#0f172a', '#1d4ed8', '#bfdbfe'],
      ['#1f2937', '#059669', '#d1fae5'],
      ['#312e81', '#f59e0b', '#fde68a'],
      ['#3f3f46', '#e11d48', '#fecdd3'],
      ['#111827', '#9333ea', '#e9d5ff'],
      ['#172554', '#22c55e', '#dcfce7'],
    ];
    const palette = palettes[seed % palettes.length] || palettes[0];
    const accentX = 28 + (seed % 44);
    const accentY = 30 + ((seed >>> 5) % 40);
    const ring = 18 + ((seed >>> 9) % 12);
    const symbol = label.slice(0, 1).toUpperCase();
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${palette[0]}"/>
            <stop offset="100%" stop-color="${palette[1]}"/>
          </linearGradient>
        </defs>
        <rect width="160" height="160" rx="48" fill="url(#bg)"/>
        <circle cx="${accentX}" cy="${accentY}" r="${ring}" fill="${palette[2]}" opacity="0.92"/>
        <circle cx="112" cy="114" r="34" fill="#ffffff" opacity="0.16"/>
        <circle cx="84" cy="62" r="18" fill="#ffffff" opacity="0.18"/>
        <text x="80" y="94" text-anchor="middle" font-size="42" font-family="Arial, sans-serif" fill="#ffffff">${symbol}</text>
      </svg>
    `.replace(/\s+/g, ' ');

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  private async attachEmbedding(tagId: string, sourceText: string, userId: string) {
    const embedding = await this.buildTagEmbedding(sourceText, userId);
    const vectorLiteral = `[${embedding.map((value) => value.toFixed(6)).join(',')}]`;

    await this.prisma.$executeRawUnsafe(
      `UPDATE "user_tags" SET "embedding" = '${vectorLiteral}'::vector WHERE "id" = '${tagId}'::uuid`,
    );
  }

  private async buildTagEmbedding(text: string, userId?: string) {
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    if (!apiKey) {
      return this.buildDeterministicEmbedding(text);
    }

    const model = aiConfig.openaiEmbeddingModel;

    try {
      const response = await fetch(`${aiConfig.openaiBaseUrl}/embeddings`, {
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
        usage?: {
          prompt_tokens?: number;
          total_tokens?: number;
        };
      };
      const usage = payload.usage;
      await this.aiUsageService.logGeneration({
        userId,
        feature: 'onboarding.embedding',
        promptKey: 'onboarding.embedding',
        provider: 'openai',
        model,
        inputTokens: usage?.prompt_tokens || usage?.total_tokens || 0,
        outputTokens: 0,
        totalTokens: usage?.total_tokens || usage?.prompt_tokens || 0,
      });
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

  private async callOpenAiJson<T>(
    prompt: string,
    options: {
      userId?: string;
      feature: string;
      promptKey: string;
    },
  ): Promise<T | null> {
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    if (!apiKey) {
      return null;
    }

    const model = aiConfig.openaiModel;

    try {
      const response = await fetch(`${aiConfig.openaiBaseUrl}/chat/completions`, {
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
              content:
                'You are a strict JSON generator. Output only one JSON object and nothing else.',
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
      });
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return null;
      }

      const parsed = this.safeParseJson(content);
      return parsed as T;
    } catch (error) {
      this.logger.warn(`OpenAI call error: ${(error as Error).message}`);
      await this.serverLogService.warn(
        'onboarding.openai.error',
        'openai call failed',
        {
          feature: options.feature,
          error: (error as Error).message,
        },
      );
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

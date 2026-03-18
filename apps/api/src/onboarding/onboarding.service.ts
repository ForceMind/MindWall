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
  type?: 'onboarding' | 'deep';
}

interface SendMessageBody {
  message?: string;
  skip?: boolean;
}

interface SaveBasicsBody {
  gender?: string;
  age?: number;
}

interface SaveCityBody {
  city?: string;
}

type TurnRole = 'assistant' | 'user';

export interface InterviewTurn {
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
  // private readonly totalQuestions = 4;
  private readonly maxInvalidAttempts = 5;
  private readonly warnAtAttempt = 4;
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
    '你最近生活里有什么让你感到开心或有成就感的事情？',
    '你觉得自己身上最喜欢的特质是什么？它是怎么形成的？',
    '如果一个人想真正认识你，你最希望他先看到你的哪一面？',
    '在亲密关系里，你觉得什么样的相处方式会让你感到舒服和安全？',
    '你最珍视的一段关系或记忆，它教会了你什么？',
  ];
  private readonly interviewFocuses = [
    '个人亮点与正向特质',
    '理想关系与舒适相处',
    '自我认知与成长体验',
    '渴望被看见的真实部分',
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

    return this.initializeSession(user.id, city, body.type);
  }

  async startSessionForUser(
    userId: string,
    body: Omit<StartSessionBody, 'auth_provider_id'>,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (user.status === 'restricted') {
      throw new BadRequestException('你的账号已被限制，无法进行访谈。');
    }

    // Try to resume an existing in-progress session
    const existing = await this.prisma.onboardingInterviewSession.findFirst({
      where: { user_id: userId, status: 'in_progress' },
      orderBy: { updated_at: 'desc' },
    });
    if (existing) {
      const records = await this.prisma.onboardingInterviewRecord.findMany({
        where: { session_id: existing.id },
        orderBy: { turn_index: 'asc' },
      });
      const turns: InterviewTurn[] = records.map((r) => ({
        role: r.role as TurnRole,
        content: r.content,
        createdAt: r.created_at.toISOString(),
      }));
      const session: OnboardingSession = {
        sessionId: existing.id,
        userId,
        turns,
        answerCount: existing.answer_count,
        totalQuestions: existing.total_questions,
      };
      this.sessions.set(existing.id, session);
      const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
      return {
        status: 'in_progress',
        session_id: existing.id,
        user_id: userId,
        city: body.city?.trim() || null,
        assistant_message: lastAssistant?.content || '让我们继续访谈吧。',
        remaining_questions: existing.total_questions - existing.answer_count,
        turns,
      };
    }

    // Only set to onboarding if not already active (active users can do deep interviews)
    if (user.status !== 'active') {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'onboarding',
        },
      });
    }

    return this.initializeSession(userId, body.city?.trim() || null, body.type);
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

  async skipSessionForUser(sessionId: string, userId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      // Also check DB for persisted session
      const dbSession = await this.prisma.onboardingInterviewSession.findUnique({
        where: { id: sessionId },
      });
      if (!dbSession || dbSession.user_id !== userId || dbSession.status !== 'in_progress') {
        throw new NotFoundException('Onboarding session not found.');
      }
    }

    // Need at least 1 answer to extract tags
    const answerCount = session?.answerCount || 0;
    const turns = session?.turns || [];

    if (answerCount > 0 && turns.length > 0) {
      const extracted = await this.extractTags(turns, userId);
      await this.persistTags(userId, extracted);
    } else {
      // No answers at all — use empty fallback tags and set user active
      const fallback = this.fallbackTagExtraction([]);
      await this.persistTags(userId, fallback);
    }

    await this.prisma.onboardingInterviewSession.update({
      where: { id: sessionId },
      data: { status: 'completed', completed_at: new Date() },
    });
    this.sessions.delete(sessionId);

    const publicTags = await this.prisma.userTag.findMany({
      where: {
        user_id: userId,
        type: UserTagType.PUBLIC_VISIBLE,
      },
      select: { tag_name: true, weight: true, ai_justification: true },
      orderBy: { weight: 'desc' },
    });

    return {
      status: 'completed',
      user_id: userId,
      public_tags: publicTags,
      onboarding_summary: '基于已完成的访谈内容生成画像。',
    };
  }

  private async initializeSession(userId: string, city: string | null, type: 'onboarding' | 'deep' = 'onboarding') {
    const sessionId = randomUUID();

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

    // Mark any old in-progress sessions as completed
    await this.prisma.onboardingInterviewSession.updateMany({
      where: { user_id: userId, status: 'in_progress' },
      data: { status: 'completed', completed_at: new Date() },
    });

    // Create persistent session record
    await this.prisma.onboardingInterviewSession.create({
      data: {
        id: sessionId,
        user_id: userId,
        status: 'in_progress',
        answer_count: 0,
        total_questions: type === 'deep' ? 8 : 4,
        invalid_attempt_count: 0,
      },
    });

    const firstQuestion = await this.generateQuestion([], 0, type === 'deep' ? 8 : 4, userId);
    const session: OnboardingSession = {
      sessionId,
      userId,
      turns: [],
      answerCount: 0,
      totalQuestions: type === 'deep' ? 8 : 4,
    };

    this.sessions.set(sessionId, session);
    try {
      await this.appendTurn(session, 'assistant', firstQuestion);
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }

    return {
      status: 'in_progress',
      session_id: sessionId,
      user_id: userId,
      city,
      assistant_message: firstQuestion,
      remaining_questions: type === 'deep' ? 8 : 4,
      turns: session.turns,
    };
  }

  private async submitMessageInternal(
    sessionId: string,
    session: OnboardingSession,
    body: SendMessageBody,
  ) {
    const isSkipBtn = body.skip === true;
    const message = isSkipBtn ? '这题跳过，换一个问题吧。' : body.message?.trim();
    if (!message) {
      throw new BadRequestException('message is required.');
    }

    const prevQs = this.getPreviousAssistantQuestions(session.turns);
    const latestQuestion = prevQs[prevQs.length - 1] || '';

    let valid = isSkipBtn;
    let isSkipAction = isSkipBtn;
    let warningReason = '';

    if (!isSkipBtn) {
      const validation = await this.validateUserInput(message, latestQuestion, session.userId);
      valid = validation.valid;
      isSkipAction = validation.is_skip;
      warningReason = validation.reason || '';
    }

    if (!valid) {
      // Increment invalid attempt count
      const dbSession = await this.prisma.onboardingInterviewSession.findUnique({
        where: { id: sessionId },
      });
      const attempts = (dbSession?.invalid_attempt_count || 0) + 1;
      await this.prisma.onboardingInterviewSession.update({
        where: { id: sessionId },
        data: { invalid_attempt_count: attempts },
      });

      if (attempts >= this.maxInvalidAttempts) {
        // Ban the user
        await this.prisma.user.update({
          where: { id: session.userId },
          data: { status: 'restricted' },
        });
        await this.prisma.onboardingInterviewSession.update({
          where: { id: sessionId },
          data: { status: 'blocked' },
        });
        this.sessions.delete(sessionId);
        await this.serverLogService.warn('onboarding.input.banned', 'user banned for invalid input', {
          user_id: session.userId,
          attempts,
        });
        throw new BadRequestException('由于多次输入无关内容，你的账号已被限制。');
      }

      const warning = attempts >= this.warnAtAttempt
        ? '请输入与访谈相关的真实回答。再输入无关内容将导致账号被限制。'
        : (warningReason || '你的回答似乎与访谈无关，请认真回答问题。');

      return {
        status: 'invalid_input',
        session_id: sessionId,
        warning,
        invalid_attempts: attempts,
        remaining_before_ban: this.maxInvalidAttempts - attempts,
      };
    }

    await this.appendTurn(session, 'user', message);
    
    if (!isSkipAction) {
      session.answerCount += 1;
    }

    // Sync answer count to DB
    await this.prisma.onboardingInterviewSession.update({
      where: { id: sessionId },
      data: { answer_count: session.answerCount },
    });

    if (session.answerCount < session.totalQuestions) {
      const nextQuestion = await this.generateQuestion(
        session.turns,
        session.answerCount,
        session.totalQuestions,
        session.userId,
        isSkipAction,
      );
      await this.appendTurn(session, 'assistant', nextQuestion);

      return {
        status: 'in_progress',
        session_id: sessionId,
        assistant_message: nextQuestion,
        remaining_questions: session.totalQuestions - session.answerCount,
      };
    }

    const extracted = await this.extractTags(session.turns, session.userId);
    await this.persistTags(session.userId, extracted);

    // Mark session completed in DB
    await this.prisma.onboardingInterviewSession.update({
      where: { id: sessionId },
      data: { status: 'completed', completed_at: new Date() },
    });
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

  private async validateUserInput(
    message: string,
    latestQuestion: string,
    userId: string,
  ): Promise<{ valid: boolean; is_skip: boolean; reason?: string }> {
    if (!message || message.length < 2) {
      return { valid: false, is_skip: false };
    }
    // Basic heuristic: pure nonsense, random chars, too short
    const stripped = message.replace(/[\s\p{P}\p{S}]+/gu, '');
    if (stripped.length < 2) {
      return { valid: false, is_skip: false };
    }

    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;
    if (!apiKey) {
      // Without AI, apply simple heuristics only
      const isSkipPattern = /换[个一]?[题问]|不[大太]?[懂知道]|跳过|太难|不会答|不想说/i;
      const isSkip = isSkipPattern.test(message);
      return { valid: stripped.length >= 4 || isSkip, is_skip: isSkip };
    }

    const prompt = [
      '你负责评估心理访谈中用户的回答。',
      `当前AI的提问是：《${latestQuestion}》`,
      `用户回答是：《${message}》`,
      '',
      '请判断用户的回答属于哪种情况，并返回严格JSON格式：{"valid": true或false, "is_skip": true或false, "reason": "如果不valid给出回复用户的简短话语，否则留空"}',
      '',
      '【判定规则，按顺序匹配】',
      '1. 如果是纯语气词敷衍（如"哈哈"、"哦"）、瞎打的乱码（如"111"）、人身攻击或调侃（如"你有病"、"你妈"、"傻逼"）、与访谈毫无关系的胡言乱语 -> valid: false, is_skip: false。此时在 reason 里给出一句自然的第一人称回怼或提醒（如："哎呀不要开玩笑啦，认真回答一下好吗？"或"我听不太懂，这好像跟问题无关哦。"）',
      '2. 如果用户明确要求跳过、换一题、或者表示看不懂、不知道怎么回答、太难了、不想说 -> valid: true, is_skip: true',
      '3. 如果用户正在提供哪怕非常简短的个人状态、经历、感受（如"输钱"、"累"、"失眠"、"挺好的"） -> valid: true, is_skip: false',
      '',
      '注意：对于用户的真实经历（如"输钱"、"分手"）要判定为 valid: true；但如果是明显的调戏敷衍（如"哈哈"、"你有兵"），必须判定为 valid: false 并给出合理的 reason 提醒！',
    ].join('\n');

    const data = await this.callOpenAiJson<{ valid?: boolean; is_skip?: boolean; reason?: string }>(prompt, {
      userId,
      feature: 'onboarding.input_validation',
      promptKey: 'onboarding.input_validation',
      temperature: 0.1,
    });

    if (data === null) {
      // AI unavailable, fallback to accepting
      const isSkipPattern = /换[个一]?[题问]|不[大太]?[懂知道]|跳过|太难|不会答|不想说/i;
      const isSkip = isSkipPattern.test(message);
      return { valid: stripped.length >= 4 || isSkip, is_skip: isSkip };
    }

    return { 
      valid: data.valid !== false, 
      is_skip: data.is_skip === true,
      reason: data.reason,
    };
  }

  private async appendTurn(
    session: OnboardingSession,
    role: TurnRole,
    content: string,
  ) {
    const createdAt = new Date().toISOString();
    session.turns.push({
      role,
      content,
      createdAt,
    });

    await this.prisma.onboardingInterviewRecord.create({
      data: {
        user_id: session.userId,
        session_id: session.sessionId,
        turn_index: session.turns.length,
        role,
        content,
      },
    });
  }

  private async generateQuestion(
    turns: InterviewTurn[],
    turnIndex: number,
    totalQuestions: number,
    userId?: string,
    isSkipAction?: boolean,
  ) {
    const previousQuestions = this.getPreviousAssistantQuestions(turns);
    const latestUserAnswer = this.getLatestUserAnswer(turns);
    const fallback = this.pickFallbackQuestion(
      turnIndex,
      previousQuestions,
      isSkipAction ? '' : latestUserAnswer,
      userId,
    );
    const focus = this.getInterviewFocus(turnIndex);
    const aiConfig = await this.adminConfigService.getAiConfig();
    const apiKey = aiConfig.openaiApiKey;

    if (!apiKey) {
      return fallback;
    }

    const transcript = this.renderTranscript(turns);
    const defaultPrompt = [
      'You are the interview guide for 有间, an anonymous social platform focused on the modern inner world.',
      '有间 wants to understand users through warm, positive conversations that feel safe and encouraging.',
      'Ask exactly one emotionally warm Chinese question.',
      'Do not ask about hobbies, food, travel, favorite movies, career trivia, MBTI, or any shallow profile questions.',
      'The question should feel warm, curious, and non-judgmental. Start from positive angles (strengths, hopes, values, good experiences).',
      'Return strict JSON only: {"question":"..."}',
      'Requirements:',
      '- Chinese only',
      '- No numbering',
      '- One question only',
      '- 20-60 Chinese characters',
      '- For early turns (1-2): focus on positive qualities, strengths, values, good memories, what makes the user unique',
      '- For later turns (3+): gently explore self-perception, boundaries, how the user wants to be understood',
      '- Never start with heavy or painful topics. Approach depth gradually.',
      '- Talk like a real friend or gentle counselor. Be natural and conversational.',
      '- Every turn must switch to a different focus from previous turns',
      '- Never repeat any previous question in wording or intent',
    ].join('\n');
    const promptTemplate = await this.promptTemplateService.getPrompt(
      'onboarding.question',
      defaultPrompt,
    );
    const hardConstraints = [
      'Hard constraints (must follow):',
      '- Ask one question only',
      isSkipAction 
        ? '- The user just skipped or did not understand the previous question. You MUST generate a completely DIFFERENT, easier question from a new angle. DO NOT quote or mention that they asked to skip.'
        : '- You must sound like a real, empathetic human. Do NOT use stiff template phrases like "你如何理解..." or "XXX代表的深层意义".',
      '- If the user\'s answer is very brief (like one or two words), briefly acknowledge their feeling, then ask a natural related open question.',
      '- Do NOT directly quote the user mechanically (e.g. do not say "关于‘某词’...").',
      '- Must not repeat previous questions',
      '- Chinese only',
      '- Must be open-ended and require narration',
      '- Do NOT use yes/no style such as 是否、会不会、有没有、是不是、能不能',
    ].join('\n');
    const prompt = [
      promptTemplate,
      hardConstraints,
      `Current turn: ${turnIndex + 1} / ${totalQuestions}`,
      `Current focus: ${focus}`,
      `Latest user answer: ${latestUserAnswer || '(none)'}`,
      'Previous assistant questions:',
      previousQuestions.length > 0
        ? previousQuestions.map((item, index) => `${index + 1}. ${item}`).join('\n')
        : '(none)',
      'Interview transcript:',
      transcript || '(empty)',
    ].join('\n');

    const data = await this.callOpenAiJson<{ question?: string }>(prompt, {
      userId,
      feature: 'onboarding.question',
      promptKey: 'onboarding.question',
      temperature: 0.78,
    });
    const question = data?.question?.trim();
    if (!question) {
      return fallback;
    }
    if (
      this.isRepeatedQuestion(question, previousQuestions) ||
      this.isClosedEndedQuestion(question)
    ) {
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
      'You are the tag analyst for 有间.',
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
      '- 4 to 8 public tags, minimum 4',
      '- 5 to 10 hidden traits',
      '- hidden traits MUST use Chinese words for tag_name (e.g. "骚扰倾向" instead of harassment_tendency, "情绪稳定" instead of emotional_stability)',
        '- All tag_name values (for BOTH public_tags and hidden_system_traits) MUST be entirely in Chinese',
      '- public tags should be emotionally meaningful, not generic hobbies',
      '- onboarding_summary should be one Chinese sentence, within 50 Chinese characters when possible',
      '- onboarding_summary MUST be in Chinese only, absolutely no English words',
      '- All tag_name values MUST be in Chinese',
      '- All ai_justification values MUST be in Chinese',
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
      temperature: 0.25,
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

    if (!hiddenTags.some((tag) => tag.tag_name === '骚扰倾向' || tag.tag_name === 'harassment_tendency')) {
      hiddenTags.push({
        tag_name: '骚扰倾向',
        weight: 1,
        ai_justification: '默认处于低风险区间，后续会根据真实互动动态校准。',
      });
    }

    const rawSummary = input.onboarding_summary?.trim() || fallback.onboarding_summary;
    // If summary contains English, use fallback
    const hasEnglish = /[a-zA-Z]{3,}/.test(rawSummary);
    const onboarding_summary = hasEnglish ? fallback.onboarding_summary : rawSummary;

    // Ensure at least 3 public tags; fill from fallback if needed
    const minPublicTags = 3;
    let finalPublicTags = publicTags.length > 0 ? publicTags : fallback.public_tags;
    if (finalPublicTags.length < minPublicTags) {
      const existingNames = new Set(finalPublicTags.map((t) => t.tag_name));
      for (const fTag of fallback.public_tags) {
        if (finalPublicTags.length >= minPublicTags) break;
        if (!existingNames.has(fTag.tag_name)) {
          finalPublicTags.push(fTag);
          existingNames.add(fTag.tag_name);
        }
      }
    }

    return {
      public_tags: finalPublicTags,
      hidden_system_traits:
        hiddenTags.length > 0 ? hiddenTags : fallback.hidden_system_traits,
      onboarding_summary,
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
          tag_name: '情绪稳定',
          weight: 7.3,
          ai_justification: '整体表达稳定，情绪波动可感知但未失控。',
        },
        {
          tag_name: '共情能力',
          weight: 7.8,
          ai_justification: '对他人感受与关系氛围有较强感知。',
        },
        {
          tag_name: '边界尊重',
          weight: 8.4,
          ai_justification: '对边界、分寸和安全感有明确意识。',
        },
        {
          tag_name: '冲突容忍度',
          weight: 6.4,
          ai_justification: '面对差异时具备一定承受能力，但仍需要安全感支撑。',
        },
        {
          tag_name: '骚扰倾向',
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

  private getPreviousAssistantQuestions(turns: InterviewTurn[]) {
    return turns
      .filter((turn) => turn.role === 'assistant')
      .map((turn) => turn.content.trim())
      .filter((item) => Boolean(item));
  }

  private getLatestUserAnswer(turns: InterviewTurn[]) {
    const latest = [...turns]
      .reverse()
      .find((turn) => turn.role === 'user');
    return latest?.content?.trim() || '';
  }

  private pickFallbackQuestion(
    turnIndex: number,
    previousQuestions: string[],
    latestUserAnswer: string,
    userSeedText?: string,
  ) {
    const history = new Set(
      previousQuestions.map((item) => this.normalizeQuestionText(item)),
    );
    const adaptive = this.buildAdaptiveFallbackQuestion(
      turnIndex,
      latestUserAnswer,
      previousQuestions,
    );
    if (adaptive) {
      return adaptive;
    }

    const total = this.fallbackQuestions.length;
    const baseOffset = userSeedText ? this.hashSeed(userSeedText) % total : 0;
    for (let offset = 0; offset < total; offset += 1) {
      const candidate =
        this.fallbackQuestions[(baseOffset + turnIndex + offset) % total];
      if (!history.has(this.normalizeQuestionText(candidate))) {
        return candidate;
      }
    }
    return this.fallbackQuestions[(baseOffset + turnIndex) % total];
  }

  private getInterviewFocus(turnIndex: number) {
    return (
      this.interviewFocuses[turnIndex % this.interviewFocuses.length] ||
      '内在冲突与关系边界'
    );
  }

  private buildAdaptiveFallbackQuestion(
    turnIndex: number,
    latestUserAnswer: string,
    previousQuestions: string[],
  ) {
    const text = (latestUserAnswer || '').trim();
    if (!text || text.length < 2) {
      return '';
    }

    const focusType = turnIndex % this.interviewFocuses.length;
    let candidate = '';
    
    switch (focusType) {
      case 0:
        candidate = '这似乎对你有挺深的影响。能具体聊聊，它如何展现或塑造了现在的你吗？';
        break;
      case 1:
        candidate = '原来如此。那在平时的感情和关系里，什么样的相处模式会让你觉得舒服且安全？';
        break;
      case 2:
        candidate = '听起来挺有感触的。这段经历最核心地教会了你什么？';
        break;
      case 3:
      default:
        candidate = '我大概理解了。那你最希望别人能越过表面现象，去看到你内心深处的哪一面？';
        break;
    }

    if (
      this.isRepeatedQuestion(candidate, previousQuestions) ||
      this.isClosedEndedQuestion(candidate)
    ) {
      return '';
    }

    return candidate;
  }

  private isRepeatedQuestion(candidate: string, previousQuestions: string[]) {
    const normalizedCandidate = this.normalizeQuestionText(candidate);
    if (!normalizedCandidate) {
      return false;
    }

    for (const previous of previousQuestions) {
      const normalizedPrevious = this.normalizeQuestionText(previous);
      if (!normalizedPrevious) {
        continue;
      }

      if (normalizedCandidate === normalizedPrevious) {
        return true;
      }

      if (
        normalizedCandidate.length >= 8 &&
        normalizedPrevious.length >= 8 &&
        (normalizedCandidate.includes(normalizedPrevious) ||
          normalizedPrevious.includes(normalizedCandidate))
      ) {
        return true;
      }
    }

    return false;
  }

  private isClosedEndedQuestion(candidate: string) {
    const compact = (candidate || '').replace(/\s+/g, '');
    if (!compact) {
      return true;
    }

    if (/^[是否会有嗯啊好可不行对错]+\??$/.test(compact)) {
      return true;
    }

    const closedPatterns = [
      /^你?是否/u,
      /^你?会不会/u,
      /^你?有没有/u,
      /^你?是不是/u,
      /^你?能不能/u,
      /^会不会/u,
      /^是不是/u,
      /^有没有/u,
      /^能不能/u,
      /是否/u,
      /会不会/u,
      /有没有/u,
      /是不是/u,
      /能不能/u,
    ];
    if (closedPatterns.some((pattern) => pattern.test(compact))) {
      return true;
    }

    return false;
  }

  private normalizeQuestionText(text: string) {
    return (text || '')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '')
      .trim();
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
    const apiKey = aiConfig.openaiEmbeddingApiKey;
    if (!apiKey) {
      return this.buildDeterministicEmbedding(text);
    }

    const model = aiConfig.openaiEmbeddingModel;
    if (!model) {
      return this.buildDeterministicEmbedding(text);
    }

    try {
      const response = await fetch(
        this.adminConfigService.getEmbeddingsUrl(aiConfig.openaiBaseUrl),
        {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: text.slice(0, 4000),
        }),
        },
      );

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
        metadata: {
          prompt: text.slice(0, 500) + (text.length > 500 ? '...' : ''),
        },
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
      temperature?: number;
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
          temperature: options.temperature ?? 0.45,
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
        },
      );

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

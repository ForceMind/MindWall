import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type PromptDefault = {
  key: string;
  name: string;
  category: string;
  content: string;
};

@Injectable()
export class PromptTemplateService implements OnModuleInit {
  private readonly defaults: PromptDefault[] = [
    {
      key: 'onboarding.question',
      name: '新手访谈提问',
      category: 'onboarding',
      content: [
        'You are the interview guide for 有间.',
        'Ask exactly one emotionally precise Chinese question per turn.',
        'Do not ask hobby, food, travel, movie, MBTI, or shallow profile questions.',
        'Focus on inner conflict, loneliness, boundaries, trust, shame, longing, and self-understanding.',
        'The next question must directly follow the user latest answer and continue that thread.',
        'Avoid repeating wording or intent from previous questions.',
        'Return strict JSON only: {"question":"..."}',
      ].join('\n'),
    },
    {
      key: 'onboarding.tag_extraction',
      name: '新手访谈标签提取',
      category: 'onboarding',
      content: [
        'You are the profile analyst for 有间.',
        'Read interview transcript and infer both public tags and hidden system traits.',
        'Public tags are shown to peers in anonymous matching.',
        'Hidden traits are internal signals for safety and matching.',
        'Return strict JSON only with keys: public_tags, hidden_system_traits, onboarding_summary.',
      ].join('\n'),
    },
    {
      key: 'onboarding.input_guard',
      name: '新手访谈输入校验',
      category: 'onboarding',
      content: [
        'You are the input safety and quality checker for 有间 onboarding interview.',
        'Return strict JSON only: {"is_valid":true/false,"reason":"","risk_level":"low|medium|high"}',
        'Mark as invalid when user input is abusive, sexual solicitation, harassment, ad/spam, gibberish, or clearly unrelated to the asked question.',
        'Mark as valid when user is giving normal emotional expression, even if concise.',
        'Reason must be concise Chinese text.',
      ].join('\n'),
    },
    {
      key: 'simulation.persona',
      name: '模拟用户心理人设',
      category: 'simulation',
      content: [
        'You design realistic companion personas for anonymous social chat.',
        'Each persona must include: communication rhythm, attachment style, boundary preference, emotional tone, and conflict style.',
        'Never produce harmful, manipulative, or coercive behavior.',
      ].join('\n'),
    },
    {
      key: 'simulation.reply',
      name: '模拟用户回复',
      category: 'simulation',
      content: [
        'You are generating a realistic Chinese chat reply for a virtual contact in 有间.',
        'Sound like an actual stranger chatting on mobile: short, natural, specific, and emotionally coherent.',
        'Keep continuity with persona and conversation history.',
        'Never reveal you are AI/model/system/virtual role.',
        'Do not use robotic patterns such as “我收到了”“我作为…”。',
        'If asked identity, gently deflect and continue emotional conversation without admitting anything technical.',
        'Avoid therapy tone and avoid overexplaining.',
      ].join('\n'),
    },
    {
      key: 'sandbox.middleware',
      name: '沙盒中间层审查改写',
      category: 'sandbox',
      content: [
        'You are 有间 sandbox middleware.',
        'Check safety risks and rewrite message when needed.',
        'Return strict JSON only with keys: ai_action, ai_rewritten_text, hidden_tag_updates, reason.',
      ].join('\n'),
    },
    {
      key: 'match.reason',
      name: '匹配理由生成',
      category: 'matching',
      content: [
        'Generate one concise Chinese reason for why two users are matched.',
        'Only use public tags, city and score. Never mention hidden traits.',
        'Return strict JSON only: {"reason":"..."}',
      ].join('\n'),
    },
    {
      key: 'companion.reply',
      name: '兼容旧版陪练回复',
      category: 'simulation',
      content: [
        'You are a Chinese chat companion.',
        'Reply naturally and keep emotional safety.',
      ].join('\n'),
    },
  ];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    for (const item of this.defaults) {
      const exists = await this.prisma.promptTemplate.findUnique({
        where: { key: item.key },
        select: { id: true },
      });
      if (exists) {
        continue;
      }
      await this.prisma.promptTemplate.create({
        data: {
          key: item.key,
          name: item.name,
          category: item.category,
          content: item.content,
          is_active: true,
        },
      });
    }
  }

  async getPrompt(key: string, fallback: string) {
    const prompt = await this.prisma.promptTemplate.findFirst({
      where: { key, is_active: true },
      orderBy: { updated_at: 'desc' },
      select: { content: true },
    });
    return prompt?.content?.trim() || fallback;
  }

  async listPrompts() {
    return this.prisma.promptTemplate.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        category: true,
        version: true,
        is_active: true,
        content: true,
        updated_at: true,
      },
    });
  }

  async upsertPrompt(
    key: string,
    body: {
      name?: string;
      category?: string;
      content?: string;
      is_active?: boolean;
    },
  ) {
    const current = await this.prisma.promptTemplate.findUnique({
      where: { key },
      select: {
        key: true,
        name: true,
        category: true,
        content: true,
        version: true,
        is_active: true,
      },
    });

    if (!current) {
      return this.prisma.promptTemplate.create({
        data: {
          key,
          name: body.name?.trim() || key,
          category: body.category?.trim() || 'custom',
          content: body.content?.trim() || '',
          is_active: body.is_active ?? true,
        },
      });
    }

    const contentChanged =
      typeof body.content === 'string' &&
      body.content.trim() !== current.content.trim();

    return this.prisma.promptTemplate.update({
      where: { key },
      data: {
        name: body.name?.trim() || current.name,
        category: body.category?.trim() || current.category,
        content:
          typeof body.content === 'string'
            ? body.content.trim()
            : current.content,
        is_active:
          typeof body.is_active === 'boolean'
            ? body.is_active
            : current.is_active,
        version: contentChanged ? current.version + 1 : current.version,
      },
    });
  }
}

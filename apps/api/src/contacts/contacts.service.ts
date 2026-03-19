import { Injectable, NotFoundException } from '@nestjs/common';
import { PRESET_PERSONAS } from '../companion/personas';
import { MatchStatus, UserTagType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCandidateContacts(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        profile: {
          select: {
            city: true,
          },
        },
        tags: {
          where: { type: UserTagType.PUBLIC_VISIBLE },
          select: {
            tag_name: true,
            weight: true,
          },
        },
      },
    });
    if (!me) {
      throw new NotFoundException('User not found.');
    }

    const city = me.profile?.city?.trim();
    if (!city) {
      return {
        city_scope: null,
        candidates: await this.buildDiscoveryAiCandidates(me.tags, null, userId),
        ai_chat_candidates: await this.buildAiChatCandidates(userId, null),
      };
    }

    const onlineCutoff = new Date(Date.now() - 1000 * 60 * 15);
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: userId },
        status: 'active',
        profile: {
          is: { city },
        },
        sessions: {
          some: {
            last_seen_at: { gt: onlineCutoff },
            revoked_at: null,
            expires_at: { gt: new Date() }
          }
        },
      },
      take: 120,
      select: {
        id: true,
        profile: {
          select: {
            city: true,
            anonymous_name: true,
            anonymous_avatar: true,
          },
        },
        tags: {
          where: {
            type: {
              in: [UserTagType.PUBLIC_VISIBLE, UserTagType.HIDDEN_SYSTEM],
            },
          },
          select: {
            type: true,
            tag_name: true,
            weight: true,
            ai_justification: true,
          },
        },
      },
    });

    const userIds = users.map((item) => item.id);
    const matches = await this.prisma.match.findMany({
      where: {
        OR: [
          { user_a_id: userId, user_b_id: { in: userIds } },
          { user_b_id: userId, user_a_id: { in: userIds } },
        ],
        status: {
          in: [
            MatchStatus.pending,
            MatchStatus.active_sandbox,
            MatchStatus.wall_broken,
          ],
        },
      },
      select: {
        id: true,
        user_a_id: true,
        user_b_id: true,
        status: true,
        resonance_score: true,
      },
    });

    const matchByCounterpart = new Map(
      matches.map((item) => [
        item.user_a_id === userId ? item.user_b_id : item.user_a_id,
        item,
      ]),
    );

    const candidates = users
      .map((item) => {
        const publicTags = item.tags
          .filter((tag) => tag.type === UserTagType.PUBLIC_VISIBLE)
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 6)
          .map((tag) => ({
            tag_name: tag.tag_name,
            weight: tag.weight,
            ai_justification: tag.ai_justification,
          }));
        const harassmentScore =
          item.tags.find(
            (tag) =>
              tag.type === UserTagType.HIDDEN_SYSTEM &&
              tag.tag_name === 'harassment_tendency',
          )?.weight || 1;
        const score = this.computeCandidateScore(me.tags, publicTags, harassmentScore);
        const matched = matchByCounterpart.get(item.id);

        return {
          candidate_id: item.id,
          candidate_type: 'user',
          is_ai: false,
          disclosure: '匹配对象',
          city: item.profile?.city || city,
          avatar: item.profile?.anonymous_avatar || null,
          name: item.profile?.anonymous_name || '匿名用户',
          score,
          has_match: Boolean(matched),
          match_id: matched?.id || null,
          match_status: matched?.status || null,
          resonance_score: matched?.resonance_score || null,
          public_tags: publicTags,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    return {
      city_scope: city,
      candidates: [...candidates, ...await this.buildDiscoveryAiCandidates(me.tags, city, userId)],
      ai_chat_candidates: await this.buildAiChatCandidates(userId, city),
    };
  }

  async getConnectedContacts(userId: string, tab = 'active', page = 1) {
    const limit = 20;
    const skip = (page - 1) * limit;

    const isActiveTab = tab === 'active';
    const matchStatuses: MatchStatus[] = isActiveTab
        ? [MatchStatus.active_sandbox, MatchStatus.wall_broken]
      : [MatchStatus.rejected];
      
    const aiStatuses = isActiveTab ? ['active', 'active_sandbox'] : ['closed', 'history'];

    const [matches, aiSessions] = await Promise.all([
      this.prisma.match.findMany({
        where: {
          OR: [{ user_a_id: userId }, { user_b_id: userId }],
          status: { in: matchStatuses },
          // Only show matches that have at least one message
          messages: { some: {} },
        },
        orderBy: [{ updated_at: 'desc' }],
        select: {
          id: true,
          user_a_id: true,
          user_b_id: true,
          status: true,
          resonance_score: true,
          updated_at: true,
          ai_match_reason: true,
        },
      }),
      this.prisma.companionSession.findMany({
        where: {
          user_id: userId,
          status: { in: aiStatuses },
          // Exclude AI陪聊 sessions from 我的会话
          NOT: { status: 'active_chat' },
        },
        orderBy: [{ updated_at: 'desc' }],
        include: {
          _count: { select: { messages: { where: { sender_type: 'user' } } } },
        },
      })
    ]);

    const counterpartIds = Array.from(
      new Set(
        matches.map((item) =>
          item.user_a_id === userId ? item.user_b_id : item.user_a_id,
        ),
      ),
    );

    const [profiles, tags] = await Promise.all([
      this.prisma.userProfile.findMany({
        where: { user_id: { in: counterpartIds } },
        select: {
          user_id: true,
          anonymous_name: true,
          anonymous_avatar: true,
          city: true,
        },
      }),
      this.prisma.userTag.findMany({
        where: {
          user_id: { in: counterpartIds },
          type: UserTagType.PUBLIC_VISIBLE,
        },
        orderBy: { weight: 'desc' },
        select: {
          user_id: true,
          tag_name: true,
          weight: true,
          ai_justification: true,
        },
      }),
    ]);

    const profileMap = new Map(
      profiles.map((item) => [
        item.user_id,
        {
          name: item.anonymous_name || '匿名用户',
          avatar: item.anonymous_avatar || null,
          city: item.city || null,
        },
      ]),
    );
    const tagMap = new Map<
      string,
      Array<{ tag_name: string; weight: number; ai_justification: string }>
    >();
    for (const tag of tags) {
      const bucket = tagMap.get(tag.user_id) || [];
      if (bucket.length < 6) {
        bucket.push({
          tag_name: tag.tag_name,
          weight: tag.weight,
          ai_justification: tag.ai_justification,
        });
      }
      tagMap.set(tag.user_id, bucket);
    }

    const mergedContacts = [
      ...matches.map((item) => {
        const counterpartId = item.user_a_id === userId ? item.user_b_id : item.user_a_id;
        const profile = profileMap.get(counterpartId);
        return {
          match_id: item.id,
          counterpart_user_id: counterpartId,
          candidate_type: 'user',
          is_ai: false,
          disclosure: '匹配对象',
          name: profile?.name || '匿名用户',
          avatar: profile?.avatar || null,
          city: profile?.city || null,
          status: item.status,
          resonance_score: item.resonance_score,
          ai_match_reason: item.ai_match_reason,
          updated_at: item.updated_at,
          public_tags: tagMap.get(counterpartId) || [],
        };
      }),
      ...aiSessions
        .filter(session => session.persona_id !== 'ai_psychologist')
        .map(session => {
        const personaDef = PRESET_PERSONAS.find(p => p.id === session.persona_id);
        const displayName = session.persona_name && session.persona_name !== 'AI Companion'
          ? session.persona_name
          : personaDef?.name || 'AI Companion';
        // Compute resonance from user message count, same logic as companion.service
        const userMsgCount = (session as any)._count?.messages ?? 0;
        const resonanceScore = Math.min(userMsgCount * 5, 100);
        const wallBroken = resonanceScore >= 100;
        return {
          match_id: session.id,
          candidate_type: 'ai',
          is_ai: true,
          disclosure: '匹配对象',
          name: displayName,
          avatar: this.buildPersonaAvatar(session.persona_id, displayName),
          status: wallBroken ? 'wall_broken' : 'active_sandbox',
          resonance_score: resonanceScore,
          ai_match_reason: null,
          updated_at: session.updated_at,
          public_tags: [],
        };
      })
    ].sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());

    const total = mergedContacts.length;
    const paginatedContacts = mergedContacts.slice(skip, skip + limit);

    return {
      total,
      page,
      limit,
      contacts: paginatedContacts,
    };
  }

  async connectToUser(userId: string, targetUserId: string) {
    if (!targetUserId || targetUserId === userId) {
      throw new NotFoundException('Target user is invalid.');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('Target user not found.');
    }

    const [a, b] = userId < targetUserId ? [userId, targetUserId] : [targetUserId, userId];
    const existing = await this.prisma.match.findUnique({
      where: {
        user_a_id_user_b_id: {
          user_a_id: a,
          user_b_id: b,
        },
      },
      select: {
        id: true,
        status: true,
        resonance_score: true,
      },
    });

    if (existing) {
      return {
        existed: true,
        match_id: existing.id,
        status: existing.status,
        resonance_score: existing.resonance_score,
      };
    }

    const created = await this.prisma.match.create({
      data: {
        user_a_id: a,
        user_b_id: b,
        status: MatchStatus.pending,
        resonance_score: 0,
        ai_match_reason: '系统基于城市与公开标签建议你们先在沙盒里建立对话。',
      },
      select: {
        id: true,
        status: true,
        resonance_score: true,
      },
    });

    return {
      existed: false,
      match_id: created.id,
      status: created.status,
      resonance_score: created.resonance_score,
    };
  }

  private computeCandidateScore(
    selfTags: Array<{ tag_name: string; weight: number }>,
    otherTags: Array<{ tag_name: string; weight: number }>,
    harassmentScore: number,
  ) {
    const selfMap = new Map(selfTags.map((item) => [item.tag_name, item.weight]));
    const otherMap = new Map(otherTags.map((item) => [item.tag_name, item.weight]));
    const keys = new Set([...selfMap.keys(), ...otherMap.keys()]);
    let numerator = 0;
    let denominator = 0;
    for (const key of keys) {
      const left = selfMap.get(key) || 0;
      const right = otherMap.get(key) || 0;
      numerator += Math.min(left, right);
      denominator += Math.max(left, right);
    }
    const overlap = denominator > 0 ? numerator / denominator : 0;
    const riskPenalty = Math.min(28, Math.max(0, harassmentScore * 2));
    return Math.max(0, Math.min(100, Math.round(overlap * 100 - riskPenalty)));
  }

  /**
   * AI假用户 mixed into 发现匹配: real-user naming, disclosure '匹配对象', own personas
   */
  private async buildDiscoveryAiCandidates(
    selfTags: Array<{ tag_name: string; weight: number }>,
    city?: string | null,
    userId?: string,
  ) {
    const seedTags = selfTags
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((item) => item.tag_name);

    // 4-hour rotation: AI fake users come and go to simulate real online activity
    const rotationSeed = Math.floor(Date.now() / (4 * 3600000));
    const userSeed = this.hashSeed(userId || 'default');
    const nonPsych = PRESET_PERSONAS.filter(p => p.id !== 'ai_psychologist');
    const shuffled = [...nonPsych].sort((a, b) => {
      const ha = this.hashSeed(a.id + userId + rotationSeed);
      const hb = this.hashSeed(b.id + userId + rotationSeed);
      return ha - hb;
    });
    // 1-3 AI fake users that blend in with real users, rotates every 4 hours
    const aiCount = (this.hashSeed(`${userId}:disc:${rotationSeed}`) % 3) + 1;
    const aiCandidates = shuffled.slice(0, aiCount);

    const psychologist = PRESET_PERSONAS.find(p => p.id === 'ai_psychologist');

    // Psychologist only shown after user completes deep interview (total_questions >= 8)
    const hasInterview = userId ? await this.prisma.onboardingInterviewSession.count({
      where: { user_id: userId, total_questions: { gte: 8 }, status: 'completed' },
    }) > 0 : false;

    const personas = [
      ...(psychologist && hasInterview ? [{
        id: psychologist.id,
        name: psychologist.name,
        tags: [...psychologist.tags, ...seedTags].slice(0, 4),
        summary: psychologist.summary,
        disclosure: 'AI 访谈师',
      }] : []),
      // AI假用户 get '匹配对象' disclosure to blend in with real users
      ...aiCandidates.map(p => ({
        id: p.id,
        name: this.generateDynamicName(userId || '', p.id, city || null),
        tags: [...p.tags, ...seedTags].slice(0, 4),
        summary: p.summary,
        disclosure: '匹配对象',
      })),
    ];

    // Look up existing companion sessions for these AI personas
    const existingSessions = userId ? await this.prisma.companionSession.findMany({
      where: {
        user_id: userId,
        persona_id: { in: personas.map(p => p.id) },
        status: { in: ['active', 'active_sandbox'] },
      },
      orderBy: { updated_at: 'desc' },
      select: { id: true, persona_id: true },
    }) : [];
    const sessionByPersona = new Map(existingSessions.map(s => [s.persona_id, s.id]));

    return personas.map((item, index) => ({
      candidate_id: item.id,
      candidate_type: 'ai',
      is_ai: true,
      disclosure: item.disclosure,
      city: null,
      avatar: this.buildPersonaAvatar(item.id, item.name),
      name: item.name,
      score: index === 0 ? 90 : Math.max(55, 74 - (index - 1) * 5),
      has_match: sessionByPersona.has(item.id),
      match_id: sessionByPersona.get(item.id) || null,
      match_status: null,
      resonance_score: null,
      public_tags: item.tags.slice(0, 6).map((tagName) => ({
        tag_name: tagName,
        weight: 0.72,
        ai_justification: item.summary,
      })),
    }));
  }

  private buildPersonaAvatar(seed: string, label: string) {
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
    const symbol = label.slice(0, 1).toUpperCase();
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

  /**
   * AI陪聊 pool: city-based naming, 2-6 AIs with hourly rotation
   */
  private async buildAiChatCandidates(userId: string, city: string | null) {
    const hourSeed = Math.floor(Date.now() / 3600000);
    const combinedSeed = this.hashSeed(`${userId}:chat_pool:${hourSeed}`);

    // 2-6 AIs, changes hourly to simulate online/offline
    const count = (combinedSeed % 5) + 2;

    const nonPsych = PRESET_PERSONAS.filter(p => p.id !== 'ai_psychologist');
    const shuffled = [...nonPsych].sort((a, b) => {
      return this.hashSeed(a.id + userId + hourSeed) - this.hashSeed(b.id + userId + hourSeed);
    });
    const selected = shuffled.slice(0, count);

    const existingSessions = await this.prisma.companionSession.findMany({
      where: {
        user_id: userId,
        persona_id: { in: selected.map(p => p.id) },
        status: 'active_chat',
      },
      select: { id: true, persona_id: true },
    });
    const sessionByPersona = new Map(existingSessions.map(s => [s.persona_id, s.id]));

    return selected.map((p, idx) => ({
      candidate_id: p.id,
      candidate_type: 'ai' as const,
      is_ai: true,
      disclosure: 'AI 陪聊',
      city: null,
      avatar: this.buildPersonaAvatar(p.id, p.name),
      name: this.generateCityBasedName(userId, p.id, city),
      score: Math.max(50, 80 - idx * 5),
      has_match: sessionByPersona.has(p.id),
      match_id: sessionByPersona.get(p.id) || null,
      match_status: null,
      resonance_score: null,
      public_tags: p.tags.slice(0, 4).map(tagName => ({
        tag_name: tagName,
        weight: 0.72,
        ai_justification: p.summary,
      })),
    }));
  }

  private generateDynamicName(userId: string, personaId: string, city: string | null): string {
    const seed = this.hashSeed(`${userId}:${personaId}`);
    // Same naming rules as real users (onboarding.service buildAnonymousIdentity)
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

  private generateCityBasedName(userId: string, personaId: string, city: string | null): string {
    const seed = this.hashSeed(`${userId}:${personaId}:city`);
    const landmarks = (city && CITY_LANDMARKS[city]) || GENERIC_LANDMARKS;
    const landmark = landmarks[seed % landmarks.length];
    const suffix = PLACE_SUFFIXES[(seed >>> 4) % PLACE_SUFFIXES.length];
    return `${landmark}${suffix}`;
  }

  private hashSeed(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PRESET_PERSONAS } from '../companion/personas';
import { MatchStatus, UserTagType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
        candidates: this.buildAiCandidates(me.tags, null, userId),
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
      candidates: [...candidates, ...this.buildAiCandidates(me.tags, city, userId)],
    };
  }

  async getConnectedContacts(userId: string) {
    const matches = await this.prisma.match.findMany({
      where: {
        OR: [{ user_a_id: userId }, { user_b_id: userId }],
        status: {
          in: [
            MatchStatus.pending,
            MatchStatus.active_sandbox,
            MatchStatus.wall_broken,
          ],
        },
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
    });

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

    return {
      total: matches.length,
      contacts: matches.map((item) => {
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

  private buildAiCandidates(
    selfTags: Array<{ tag_name: string; weight: number }>,
    city?: string | null,
    userId?: string,
  ) {
    const seedTags = selfTags
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((item) => item.tag_name);

    // Pick 6 random personas out of the preset
    const shuffled = [...PRESET_PERSONAS].sort(() => 0.5 - Math.random());
    const aiCount = Math.floor(Math.random() * 3) + 1;
    const aiCandidates = shuffled.slice(0, aiCount);

    const personas = aiCandidates.map(p => {
      const isPsych = p.id === 'ai_psychologist';
      return {
        id: isPsych ? p.id : `${p.id}_${Date.now()}_${Math.floor(Math.random()*1000)}`, // dynamic ID so they change!
        name: isPsych ? p.name : this.generateDynamicName(userId || '', p.id, city || null),
        tags: [...p.tags, ...seedTags].slice(0, 4),
        summary: p.summary,
        disclosure: '匹配对象',
      };
    });

    return personas.map((item, index) => ({
      candidate_id: item.id,
      candidate_type: 'ai',
      is_ai: true,
      disclosure: item.disclosure,
      city: null,
      avatar: this.buildPersonaAvatar(item.id, item.name),
      name: item.name,
      score: index === 0 ? 90 : Math.max(55, 74 - (index - 1) * 5),
      has_match: false,
      match_id: null,
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

  private generateDynamicName(userId: string, personaId: string, city: string | null): string {
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
}

import { Injectable, NotFoundException } from '@nestjs/common';
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
        candidates: this.buildAiCandidates(me.tags, null),
      };
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { not: userId },
        status: 'active',
        profile: {
          is: { city },
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
      candidates: [...candidates, ...this.buildAiCandidates(me.tags, city)],
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
  ) {
    const seedTags = selfTags
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((item) => item.tag_name);

    // Generate city-flavored names when city is available
    const cityNameMap: Record<string, [string, string, string]> = {
      '北京': ['胡同漫步', '故宫夜话', '后海清风'],
      '上海': ['外滩来信', '弄堂闲话', '梧桐路口'],
      '广州': ['骑楼晚风', '茶楼小记', '珠江夜色'],
      '深圳': ['南山信号', '梅林时差', '湾区晚安'],
      '成都': ['火锅电台', '太古漫游', '锦里日常'],
      '杭州': ['西湖晨跑', '拱墅夜话', '钱塘信箱'],
      '武汉': ['江城热干', '东湖散步', '黄鹤夜话'],
      '南京': ['鸡鸣信箱', '玄武散步', '秦淮夜话'],
      '重庆': ['山城爬坡', '洪崖洞灯', '两江夜话'],
      '长沙': ['橘洲电台', '岳麓散步', '湘江夜话'],
    };

    const cityNames = (city && cityNameMap[city]) || null;

    const personas = [
      {
        id: 'ai_reflective',
        name: cityNames?.[0] || '夏雾来信',
        tags: ['情绪共情', '慢节奏交流', ...seedTags],
        summary: city
          ? `同在${city}，偏向接住情绪、循序推进关系。`
          : '偏向接住情绪、循序推进关系。',
      },
      {
        id: 'ai_boundary',
        name: cityNames?.[1] || '林间坐标',
        tags: ['边界感', '关系观察', ...seedTags],
        summary: city
          ? `同在${city}，偏向清晰边界、稳定沟通。`
          : '偏向清晰边界、稳定沟通。',
      },
      {
        id: 'ai_warm',
        name: cityNames?.[2] || '夜航电台',
        tags: ['温柔表达', '安全陪伴', ...seedTags],
        summary: city
          ? `同在${city}，偏向温和聊天与日常安抚。`
          : '偏向温和聊天与日常安抚。',
      },
    ];

    return personas.map((item, index) => ({
      candidate_id: item.id,
      candidate_type: 'ai',
      is_ai: true,
      disclosure: '匹配对象',
      city: null,
      avatar: this.buildPersonaAvatar(item.id, item.name),
      name: item.name,
      score: Math.max(55, 74 - index * 5),
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
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { AiUsageService } from '../telemetry/ai-usage.service';
import { PromptTemplateService } from '../telemetry/prompt-template.service';
import { ServerLogService } from '../telemetry/server-log.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiUsageService: AiUsageService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly serverLogService: ServerLogService,
  ) {}

  async getOverview() {
    const now = new Date();
    const onlineCutoff = new Date(Date.now() - 1000 * 60 * 5);

    const [registeredUsers, activeSessions, onlineSessions, statusGroups, aiUsage] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.authSession.count({
          where: {
            revoked_at: null,
            expires_at: { gt: now },
          },
        }),
        this.prisma.authSession.findMany({
          where: {
            revoked_at: null,
            expires_at: { gt: now },
            last_seen_at: { gt: onlineCutoff },
          },
          distinct: ['user_id'],
          select: { user_id: true },
        }),
        this.prisma.user.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.aiUsageService.getUsageOverview(),
      ]);

    const statusCount: Record<UserStatus, number> = {
      onboarding: 0,
      active: 0,
      restricted: 0,
    };
    for (const row of statusGroups) {
      statusCount[row.status] = row._count._all;
    }

    return {
      registered_users: registeredUsers,
      active_sessions: activeSessions,
      online_users: onlineSessions.length,
      user_status: statusCount,
      ai_usage: aiUsage,
    };
  }

  async listUsers(page: number, limit: number) {
    const safePage = Math.max(1, Math.round(page || 1));
    const safeLimit = Math.max(1, Math.min(100, Math.round(limit || 20)));
    const skip = (safePage - 1) * safeLimit;

    const [total, users, onlineSessions] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.findMany({
        skip,
        take: safeLimit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          status: true,
          created_at: true,
          credential: {
            select: { username: true },
          },
          profile: {
            select: {
              anonymous_name: true,
              city: true,
              gender: true,
              age: true,
            },
          },
        },
      }),
      this.prisma.authSession.findMany({
        where: {
          revoked_at: null,
          expires_at: { gt: new Date() },
          last_seen_at: { gt: new Date(Date.now() - 1000 * 60 * 5) },
        },
        distinct: ['user_id'],
        select: { user_id: true },
      }),
    ]);

    const onlineSet = new Set(onlineSessions.map((item) => item.user_id));
    return {
      page: safePage,
      limit: safeLimit,
      total,
      users: users.map((item) => ({
        id: item.id,
        username: item.credential?.username || null,
        status: item.status,
        created_at: item.created_at,
        online: onlineSet.has(item.id),
        profile: item.profile,
      })),
    };
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        auth_provider_id: true,
        status: true,
        created_at: true,
        credential: {
          select: { username: true },
        },
        profile: {
          select: {
            real_name: true,
            real_avatar: true,
            anonymous_name: true,
            anonymous_avatar: true,
            gender: true,
            age: true,
            city: true,
            is_wall_broken: true,
            updated_at: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const now = new Date();
    const onlineCutoff = new Date(Date.now() - 1000 * 60 * 5);

    const [
      publicTags,
      hiddenTags,
      interviewRecords,
      sessions,
      totalMatches,
      recentMatches,
      recentMessages,
      sentCount,
      blockedCount,
      modifiedCount,
      passedCount,
      aiAggregate,
      aiRecords,
    ] = await Promise.all([
      this.prisma.userTag.findMany({
        where: {
          user_id: userId,
          type: 'PUBLIC_VISIBLE',
        },
        orderBy: { weight: 'desc' },
        select: {
          tag_name: true,
          weight: true,
          ai_justification: true,
          created_at: true,
        },
      }),
      this.prisma.userTag.findMany({
        where: {
          user_id: userId,
          type: 'HIDDEN_SYSTEM',
        },
        orderBy: { weight: 'desc' },
        select: {
          tag_name: true,
          weight: true,
          ai_justification: true,
          created_at: true,
        },
      }),
      this.prisma.onboardingInterviewRecord.findMany({
        where: { user_id: userId },
        orderBy: [{ created_at: 'asc' }, { turn_index: 'asc' }],
        take: 240,
        select: {
          id: true,
          session_id: true,
          turn_index: true,
          role: true,
          content: true,
          created_at: true,
        },
      }),
      this.prisma.authSession.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 30,
        select: {
          id: true,
          created_at: true,
          last_seen_at: true,
          expires_at: true,
          revoked_at: true,
        },
      }),
      this.prisma.match.count({
        where: {
          OR: [{ user_a_id: userId }, { user_b_id: userId }],
        },
      }),
      this.prisma.match.findMany({
        where: {
          OR: [{ user_a_id: userId }, { user_b_id: userId }],
        },
        orderBy: { updated_at: 'desc' },
        take: 30,
        select: {
          id: true,
          user_a_id: true,
          user_b_id: true,
          status: true,
          resonance_score: true,
          ai_match_reason: true,
          created_at: true,
          updated_at: true,
          wall_broken_at: true,
        },
      }),
      this.prisma.sandboxMessage.findMany({
        where: { sender_id: userId },
        orderBy: { created_at: 'desc' },
        take: 40,
        select: {
          id: true,
          match_id: true,
          ai_action: true,
          original_text: true,
          ai_rewritten_text: true,
          created_at: true,
          match: {
            select: {
              user_a_id: true,
              user_b_id: true,
            },
          },
        },
      }),
      this.prisma.sandboxMessage.count({
        where: { sender_id: userId },
      }),
      this.prisma.sandboxMessage.count({
        where: {
          sender_id: userId,
          ai_action: 'blocked',
        },
      }),
      this.prisma.sandboxMessage.count({
        where: {
          sender_id: userId,
          ai_action: 'modified',
        },
      }),
      this.prisma.sandboxMessage.count({
        where: {
          sender_id: userId,
          ai_action: 'passed',
        },
      }),
      this.prisma.aiGenerationLog.aggregate({
        where: { user_id: userId },
        _count: { _all: true },
        _sum: {
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          estimated_cost_usd: true,
        },
      }),
      this.prisma.aiGenerationLog.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 40,
        select: {
          id: true,
          feature: true,
          prompt_key: true,
          provider: true,
          model: true,
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          estimated_cost_usd: true,
          created_at: true,
        },
      }),
    ]);

    const activeSessions = sessions.filter(
      (item) => !item.revoked_at && item.expires_at > now,
    );
    const online = activeSessions.some((item) => item.last_seen_at > onlineCutoff);

    const counterpartIds = new Set<string>();
    for (const row of recentMatches) {
      counterpartIds.add(row.user_a_id === userId ? row.user_b_id : row.user_a_id);
    }
    for (const row of recentMessages) {
      const counterpartId =
        row.match.user_a_id === userId ? row.match.user_b_id : row.match.user_a_id;
      counterpartIds.add(counterpartId);
    }

    const counterparts = await this.prisma.user.findMany({
      where: {
        id: {
          in: Array.from(counterpartIds),
        },
      },
      select: {
        id: true,
        credential: {
          select: { username: true },
        },
        profile: {
          select: {
            anonymous_name: true,
            city: true,
          },
        },
      },
    });
    const counterpartMap = new Map(
      counterparts.map((item) => [
        item.id,
        {
          username: item.credential?.username || null,
          anonymous_name: item.profile?.anonymous_name || null,
          city: item.profile?.city || null,
        },
      ]),
    );

    const recentUserLogs = await this.readUserLogs(userId, sessions.map((item) => item.id));

    const timeline = this.buildUserTimeline({
      userCreatedAt: user.created_at,
      sessions,
      aiRecords: aiRecords.map((item) => ({
        ...item,
        estimated_cost_usd: Number(item.estimated_cost_usd),
      })),
      matches: recentMatches,
      messages: recentMessages,
      logs: recentUserLogs,
      userId,
      counterpartMap,
    });

    return {
      user: {
        id: user.id,
        auth_provider_id: user.auth_provider_id,
        username: user.credential?.username || null,
        status: user.status,
        created_at: user.created_at,
      },
      profile: user.profile,
      presence: {
        online,
        active_sessions: activeSessions.length,
        last_seen_at: sessions[0]?.last_seen_at || null,
      },
      stats: {
        total_matches: totalMatches,
        sent_messages: sentCount,
        blocked_messages: blockedCount,
        modified_messages: modifiedCount,
        passed_messages: passedCount,
        ai_calls: aiAggregate._count._all || 0,
        input_tokens: aiAggregate._sum.input_tokens || 0,
        output_tokens: aiAggregate._sum.output_tokens || 0,
        total_tokens: aiAggregate._sum.total_tokens || 0,
        estimated_cost_usd: Number(aiAggregate._sum.estimated_cost_usd || 0),
      },
      tags: {
        public: publicTags,
        hidden: hiddenTags,
      },
      interview: {
        total_turns: interviewRecords.length,
        records: interviewRecords,
      },
      tag_source: {
        strategy: '优先 AI 生成，失败时回退到内置规则算法',
        has_ai_generation: (aiAggregate._count._all || 0) > 0,
      },
      recent: {
        sessions: sessions.map((item) => ({
          ...item,
          is_active: !item.revoked_at && item.expires_at > now,
        })),
        ai_records: aiRecords.map((item) => ({
          ...item,
          estimated_cost_usd: Number(item.estimated_cost_usd),
        })),
        matches: recentMatches.map((item) => {
          const counterpartId = item.user_a_id === userId ? item.user_b_id : item.user_a_id;
          const counterpart = counterpartMap.get(counterpartId);
          return {
            ...item,
            counterpart: {
              user_id: counterpartId,
              username: counterpart?.username || null,
              anonymous_name: counterpart?.anonymous_name || null,
              city: counterpart?.city || null,
            },
          };
        }),
        messages: recentMessages.map((item) => {
          const counterpartId =
            item.match.user_a_id === userId ? item.match.user_b_id : item.match.user_a_id;
          const counterpart = counterpartMap.get(counterpartId);
          return {
            id: item.id,
            match_id: item.match_id,
            ai_action: item.ai_action,
            original_text: item.original_text,
            ai_rewritten_text: item.ai_rewritten_text,
            created_at: item.created_at,
            counterpart: {
              user_id: counterpartId,
              username: counterpart?.username || null,
              anonymous_name: counterpart?.anonymous_name || null,
            },
          };
        }),
        logs: recentUserLogs,
      },
      timeline,
    };
  }

  async listOnlineUsers(minutes: number) {
    const safeMinutes = Math.max(1, Math.min(120, Math.round(minutes || 5)));
    const cutoff = new Date(Date.now() - safeMinutes * 60 * 1000);

    const sessions = await this.prisma.authSession.findMany({
      where: {
        revoked_at: null,
        expires_at: { gt: new Date() },
        last_seen_at: { gt: cutoff },
      },
      distinct: ['user_id'],
      orderBy: { last_seen_at: 'desc' },
      select: {
        user_id: true,
        last_seen_at: true,
        user: {
          select: {
            status: true,
            credential: {
              select: { username: true },
            },
            profile: {
              select: {
                anonymous_name: true,
                city: true,
              },
            },
          },
        },
      },
    });

    return {
      window_minutes: safeMinutes,
      total_online: sessions.length,
      users: sessions.map((item) => ({
        user_id: item.user_id,
        username: item.user.credential?.username || null,
        status: item.user.status,
        last_seen_at: item.last_seen_at,
        profile: item.user.profile,
      })),
    };
  }

  async updateUserStatus(userId: string, status: UserStatus) {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('User not found.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { status },
      select: {
        id: true,
        status: true,
      },
    });
  }

  async getAiRecords(page: number, limit: number) {
    return this.aiUsageService.listRecords(page, limit);
  }

  async getPrompts() {
    return this.promptTemplateService.listPrompts();
  }

  async updatePrompt(
    key: string,
    body: {
      name?: string;
      category?: string;
      content?: string;
      is_active?: boolean;
    },
  ) {
    return this.promptTemplateService.upsertPrompt(key, body);
  }

  async getServerLogs(lines: number) {
    const tail = await this.serverLogService.tail(lines);
    return {
      file: tail.file,
      available: true,
      total_lines: tail.count,
      lines: tail.lines,
    };
  }

  async listMatches(page: number, limit: number) {
    const safePage = Math.max(1, Math.round(page || 1));
    const safeLimit = Math.max(1, Math.min(100, Math.round(limit || 20)));
    const skip = (safePage - 1) * safeLimit;

    const [total, matches] = await Promise.all([
      this.prisma.match.count(),
      this.prisma.match.findMany({
        skip,
        take: safeLimit,
        orderBy: { updated_at: 'desc' },
        select: {
          id: true,
          user_a_id: true,
          user_b_id: true,
          status: true,
          resonance_score: true,
          ai_match_reason: true,
          created_at: true,
          updated_at: true,
          wall_broken_at: true,
          _count: { select: { messages: true } },
        },
      }),
    ]);

    const userIds = new Set<string>();
    for (const m of matches) {
      userIds.add(m.user_a_id);
      userIds.add(m.user_b_id);
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: {
        id: true,
        credential: { select: { username: true } },
        profile: { select: { anonymous_name: true, city: true } },
      },
    });
    const userMap = new Map(
      users.map((u) => [u.id, {
        username: u.credential?.username || null,
        anonymous_name: u.profile?.anonymous_name || null,
        city: u.profile?.city || null,
      }]),
    );

    return {
      page: safePage,
      limit: safeLimit,
      total,
      matches: matches.map((m) => ({
        id: m.id,
        status: m.status,
        resonance_score: m.resonance_score,
        ai_match_reason: m.ai_match_reason,
        message_count: m._count.messages,
        created_at: m.created_at,
        updated_at: m.updated_at,
        wall_broken_at: m.wall_broken_at,
        user_a: { user_id: m.user_a_id, ...userMap.get(m.user_a_id) },
        user_b: { user_id: m.user_b_id, ...userMap.get(m.user_b_id) },
      })),
    };
  }

  async getMatchMessages(matchId: string, page: number, limit: number) {
    const safeLimit = Math.max(1, Math.min(200, Math.round(limit || 50)));
    const safePage = Math.max(1, Math.round(page || 1));
    const skip = (safePage - 1) * safeLimit;

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        user_a_id: true,
        user_b_id: true,
        status: true,
        resonance_score: true,
        wall_broken_at: true,
      },
    });

    if (!match) {
      throw new NotFoundException('Match not found.');
    }

    const [total, messages] = await Promise.all([
      this.prisma.sandboxMessage.count({ where: { match_id: matchId } }),
      this.prisma.sandboxMessage.findMany({
        where: { match_id: matchId },
        orderBy: { created_at: 'asc' },
        skip,
        take: safeLimit,
        select: {
          id: true,
          sender_id: true,
          ai_action: true,
          original_text: true,
          ai_rewritten_text: true,
          created_at: true,
        },
      }),
    ]);

    const userIds = [match.user_a_id, match.user_b_id];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        credential: { select: { username: true } },
        profile: { select: { anonymous_name: true } },
      },
    });
    const userMap = new Map(
      users.map((u) => [u.id, u.credential?.username || u.profile?.anonymous_name || u.id.slice(0, 8)]),
    );

    return {
      match: {
        id: match.id,
        user_a_id: match.user_a_id,
        user_b_id: match.user_b_id,
        status: match.status,
        resonance_score: match.resonance_score,
        wall_broken_at: match.wall_broken_at,
      },
      page: safePage,
      limit: safeLimit,
      total,
      messages: messages.map((m) => ({
        id: m.id,
        sender_id: m.sender_id,
        sender_name: userMap.get(m.sender_id) || m.sender_id.slice(0, 8),
        ai_action: m.ai_action,
        original_text: m.original_text,
        ai_rewritten_text: m.ai_rewritten_text,
        created_at: m.created_at,
      })),
    };
  }

  private async readUserLogs(userId: string, sessionIds: string[]) {
    const tail = await this.serverLogService.tail(1000);
    const sessionIdSet = new Set(sessionIds);
    const rows = tail.lines
      .map((line) => this.safeParseJson(line))
      .filter(
        (item): item is { ts: string; level: string; event: string; message: string; metadata: Record<string, unknown> | null } =>
          Boolean(item && typeof item === 'object'),
      )
      .filter((item) => {
        const metadata = item.metadata || null;
        if (!metadata || typeof metadata !== 'object') {
          return false;
        }

        const metaUserId = typeof metadata.user_id === 'string' ? metadata.user_id : '';
        const metaSessionId =
          typeof metadata.session_id === 'string' ? metadata.session_id : '';

        return metaUserId === userId || sessionIdSet.has(metaSessionId);
      })
      .slice(-120)
      .map((item) => ({
        ts: item.ts,
        level: item.level,
        event: item.event,
        message: item.message,
        metadata: item.metadata,
      }));

    return rows;
  }

  private buildUserTimeline(input: {
    userCreatedAt: Date;
    sessions: Array<{
      id: string;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
    }>;
    aiRecords: Array<{
      id: string;
      feature: string;
      prompt_key: string | null;
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
      created_at: Date;
    }>;
    matches: Array<{
      id: string;
      user_a_id: string;
      user_b_id: string;
      status: string;
      resonance_score: number;
      ai_match_reason: string | null;
      created_at: Date;
      updated_at: Date;
      wall_broken_at: Date | null;
    }>;
    messages: Array<{
      id: string;
      match_id: string;
      ai_action: string;
      original_text: string;
      ai_rewritten_text: string;
      created_at: Date;
      match: {
        user_a_id: string;
        user_b_id: string;
      };
    }>;
    logs: Array<{
      ts: string;
      level: string;
      event: string;
      message: string;
      metadata: Record<string, unknown> | null;
    }>;
    userId: string;
    counterpartMap: Map<
      string,
      { username: string | null; anonymous_name: string | null; city: string | null }
    >;
  }) {
    const timeline: Array<{
      ts: string;
      type: string;
      title: string;
      detail: string;
      meta?: Record<string, unknown>;
    }> = [];

    timeline.push({
      ts: input.userCreatedAt.toISOString(),
      type: 'user.created',
      title: '用户注册',
      detail: '账号已创建。',
    });

    for (const session of input.sessions) {
      timeline.push({
        ts: session.created_at.toISOString(),
        type: 'auth.login',
        title: '登录会话创建',
        detail: `会话 ${session.id.slice(0, 8)} 已创建。`,
      });

      timeline.push({
        ts: session.last_seen_at.toISOString(),
        type: 'auth.last_seen',
        title: '最近活跃',
        detail: `会话 ${session.id.slice(0, 8)} 最近活跃时间已更新。`,
      });

      if (session.revoked_at) {
        timeline.push({
          ts: session.revoked_at.toISOString(),
          type: 'auth.logout',
          title: '会话注销',
          detail: `会话 ${session.id.slice(0, 8)} 已注销。`,
        });
      }
    }

    for (const record of input.aiRecords) {
      timeline.push({
        ts: record.created_at.toISOString(),
        type: 'ai.generation',
        title: `AI 调用 · ${record.feature}`,
        detail: `${record.model} · Token ${record.total_tokens} · $${record.estimated_cost_usd.toFixed(6)}`,
        meta: {
          prompt_key: record.prompt_key,
          input_tokens: record.input_tokens,
          output_tokens: record.output_tokens,
        },
      });
    }

    for (const match of input.matches) {
      const counterpartId =
        match.user_a_id === input.userId ? match.user_b_id : match.user_a_id;
      const counterpart = input.counterpartMap.get(counterpartId);
      const counterpartName =
        counterpart?.anonymous_name ||
        counterpart?.username ||
        counterpartId.slice(0, 8);

      timeline.push({
        ts: match.created_at.toISOString(),
        type: 'match.created',
        title: '建立匹配',
        detail: `与 ${counterpartName} 建立匹配，初始共鸣值 ${match.resonance_score}。`,
        meta: { match_id: match.id, status: match.status },
      });

      timeline.push({
        ts: match.updated_at.toISOString(),
        type: 'match.updated',
        title: '匹配更新',
        detail: `状态：${this.formatMatchStatus(match.status)}，当前共鸣值 ${match.resonance_score}。`,
        meta: { match_id: match.id },
      });

      if (match.wall_broken_at) {
        timeline.push({
          ts: match.wall_broken_at.toISOString(),
          type: 'match.wall_broken',
          title: '破壁完成',
          detail: `与 ${counterpartName} 已切换为直接聊天。`,
          meta: { match_id: match.id },
        });
      }
    }

    for (const message of input.messages) {
      const counterpartId =
        message.match.user_a_id === input.userId
          ? message.match.user_b_id
          : message.match.user_a_id;
      const counterpart = input.counterpartMap.get(counterpartId);
      const counterpartName =
        counterpart?.anonymous_name ||
        counterpart?.username ||
        counterpartId.slice(0, 8);

      timeline.push({
        ts: message.created_at.toISOString(),
        type: `message.${message.ai_action}`,
        title: `发送消息 · ${this.formatMessageAction(message.ai_action)}`,
        detail: `向 ${counterpartName} 发送消息：${message.ai_rewritten_text.slice(0, 60)}`,
        meta: {
          match_id: message.match_id,
          message_id: message.id,
          ai_action: message.ai_action,
        },
      });
    }

    for (const log of input.logs) {
      timeline.push({
        ts: log.ts,
        type: `log.${String(log.event || 'event')}`,
        title: `系统日志 · ${log.event}`,
        detail: log.message,
        meta: {
          level: log.level,
          metadata: log.metadata,
        },
      });
    }

    return timeline
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 500);
  }

  private formatMatchStatus(status: string) {
    switch (status) {
      case 'pending':
        return '待确认';
      case 'active_sandbox':
        return '沙盒中';
      case 'wall_broken':
        return '已破壁';
      case 'rejected':
        return '已拒绝';
      default:
        return '未知';
    }
  }

  private formatMessageAction(action: string) {
    switch (action) {
      case 'passed':
        return '通过';
      case 'modified':
        return '改写';
      case 'blocked':
        return '拦截';
      default:
        return '未知';
    }
  }

  private safeParseJson(raw: string) {
    try {
      return JSON.parse(raw) as {
        ts: string;
        level: string;
        event: string;
        message: string;
        metadata: Record<string, unknown> | null;
      };
    } catch {
      return null;
    }
  }
}



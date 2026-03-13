import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MatchStatus, UserTagType } from '@prisma/client';
import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from '../telemetry/ai-usage.service';
import { PromptTemplateService } from '../telemetry/prompt-template.service';
import { ServerLogService } from '../telemetry/server-log.service';

interface RunMatchEngineBody {
  city?: string;
  max_matches_per_user?: number;
  min_score?: number;
  dry_run?: boolean;
}

type UserForMatching = {
  id: string;
  profile: { city: string | null } | null;
  tags: Array<{
    type: UserTagType;
    tag_name: string;
    weight: number;
    ai_justification: string;
  }>;
};

type CandidatePair = {
  userAId: string;
  userBId: string;
  score: number;
  city: string;
  reason: string;
};

@Injectable()
export class MatchEngineService {
  private readonly logger = new Logger(MatchEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminConfigService: AdminConfigService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly aiUsageService: AiUsageService,
    private readonly serverLogService: ServerLogService,
  ) {}

  async run(body: RunMatchEngineBody) {
    const city = body.city?.trim() || null;
    const maxMatchesPerUser = this.clampInt(body.max_matches_per_user ?? 3, 1, 10);
    const minScore = this.clampInt(body.min_score ?? 55, 0, 100);
    const dryRun = Boolean(body.dry_run);

    const users = await this.prisma.user.findMany({
      where: {
        status: 'active',
        profile: {
          is: city ? { city } : { city: { not: null } },
        },
      },
      select: {
        id: true,
        profile: {
          select: {
            city: true,
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

    if (users.length < 2) {
      return {
        status: 'ok',
        city_scope: city || 'ALL',
        considered_users: users.length,
        candidate_pairs: 0,
        created_matches: 0,
        dry_run: dryRun,
        matches: [],
      };
    }

    const existingPairSet = await this.loadExistingPairSet(users.map((item) => item.id));
    const cityGroups = this.groupUsersByCity(users);
    const candidates: CandidatePair[] = [];

    for (const [cityName, cityUsers] of cityGroups.entries()) {
      for (let i = 0; i < cityUsers.length; i += 1) {
        for (let j = i + 1; j < cityUsers.length; j += 1) {
          const first = cityUsers[i];
          const second = cityUsers[j];
          const [userAId, userBId] = this.canonicalPair(first.id, second.id);
          const pairKey = `${userAId}:${userBId}`;

          if (existingPairSet.has(pairKey)) {
            continue;
          }

          const firstHarassment = this.getHiddenWeight(first.tags, 'harassment_tendency');
          const secondHarassment = this.getHiddenWeight(second.tags, 'harassment_tendency');

          if (!this.canMatchByRiskTier(firstHarassment, secondHarassment)) {
            continue;
          }

          const overlapSimilarity = this.computeTagOverlap(first.tags, second.tags);
          const vectorSimilarity = await this.computeVectorSimilarity(userAId, userBId);
          const finalScore = this.computeFinalScore(
            overlapSimilarity,
            vectorSimilarity,
            firstHarassment,
            secondHarassment,
          );

          if (finalScore < minScore) {
            continue;
          }

          const reason = await this.generateMatchReason(
            first.tags,
            second.tags,
            finalScore,
            cityName,
          );

          candidates.push({
            userAId,
            userBId,
            score: finalScore,
            city: cityName,
            reason,
          });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    const perUserCounter = new Map<string, number>();
    const created: Array<{
      match_id: string;
      user_a_id: string;
      user_b_id: string;
      resonance_score: number;
      ai_match_reason: string;
      city: string;
    }> = [];

    for (const candidate of candidates) {
      const aCount = perUserCounter.get(candidate.userAId) || 0;
      const bCount = perUserCounter.get(candidate.userBId) || 0;
      if (aCount >= maxMatchesPerUser || bCount >= maxMatchesPerUser) {
        continue;
      }

      const pairKey = `${candidate.userAId}:${candidate.userBId}`;
      if (existingPairSet.has(pairKey)) {
        continue;
      }

      if (dryRun) {
        created.push({
          match_id: `dry-run-${created.length + 1}`,
          user_a_id: candidate.userAId,
          user_b_id: candidate.userBId,
          resonance_score: candidate.score,
          ai_match_reason: candidate.reason,
          city: candidate.city,
        });
      } else {
        const match = await this.prisma.match.create({
          data: {
            user_a_id: candidate.userAId,
            user_b_id: candidate.userBId,
            status: MatchStatus.pending,
            resonance_score: candidate.score,
            ai_match_reason: candidate.reason,
          },
          select: {
            id: true,
          },
        });

        created.push({
          match_id: match.id,
          user_a_id: candidate.userAId,
          user_b_id: candidate.userBId,
          resonance_score: candidate.score,
          ai_match_reason: candidate.reason,
          city: candidate.city,
        });
      }

      existingPairSet.add(pairKey);
      perUserCounter.set(candidate.userAId, aCount + 1);
      perUserCounter.set(candidate.userBId, bCount + 1);
    }

    await this.serverLogService.info('match.run', 'match engine executed', {
      city_scope: city || 'ALL',
      considered_users: users.length,
      candidate_pairs: candidates.length,
      created_matches: created.length,
      dry_run: dryRun,
    });

    return {
      status: 'ok',
      city_scope: city || 'ALL',
      considered_users: users.length,
      candidate_pairs: candidates.length,
      created_matches: created.length,
      dry_run: dryRun,
      matches: created,
    };
  }

  async getUserMatches(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const matches = await this.prisma.match.findMany({
      where: {
        status: {
          in: [
            MatchStatus.pending,
            MatchStatus.active_sandbox,
            MatchStatus.wall_broken,
          ],
        },
        OR: [{ user_a_id: userId }, { user_b_id: userId }],
      },
      orderBy: [{ resonance_score: 'desc' }, { created_at: 'desc' }],
      select: {
        id: true,
        user_a_id: true,
        user_b_id: true,
        status: true,
        resonance_score: true,
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

    const [counterpartTags, counterpartProfiles] = await Promise.all([
      this.prisma.userTag.findMany({
        where: {
          user_id: { in: counterpartIds },
          type: UserTagType.PUBLIC_VISIBLE,
        },
        orderBy: [{ weight: 'desc' }],
        select: {
          user_id: true,
          tag_name: true,
          weight: true,
          ai_justification: true,
        },
      }),
      this.prisma.userProfile.findMany({
        where: {
          user_id: { in: counterpartIds },
        },
        select: {
          user_id: true,
          city: true,
          anonymous_name: true,
          anonymous_avatar: true,
        },
      }),
    ]);

    const tagMap = new Map<
      string,
      Array<{ tag_name: string; weight: number; ai_justification: string }>
    >();
    for (const tag of counterpartTags) {
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

    const profileMap = new Map(
      counterpartProfiles.map((profile) => [
        profile.user_id,
        {
          city: profile.city,
          anonymous_name: profile.anonymous_name,
          anonymous_avatar: profile.anonymous_avatar,
        },
      ]),
    );

    return {
      user_id: userId,
      total_matches: matches.length,
      matches: matches.map((item) => {
        const counterpartId = item.user_a_id === userId ? item.user_b_id : item.user_a_id;
        return {
          match_id: item.id,
          status: item.status,
          resonance_score: item.resonance_score,
          ai_match_reason:
            item.ai_match_reason ||
            '你们在沟通节奏和公开标签上有较高重合，适合先进入匿名沙盒交流。',
          counterpart: {
            user_id: counterpartId,
            city: profileMap.get(counterpartId)?.city || null,
            anonymous_name: profileMap.get(counterpartId)?.anonymous_name || null,
            anonymous_avatar: profileMap.get(counterpartId)?.anonymous_avatar || null,
            public_tags: tagMap.get(counterpartId) || [],
          },
        };
      }),
    };
  }

  private async loadExistingPairSet(userIds: string[]) {
    const existingMatches = await this.prisma.match.findMany({
      where: {
        status: {
          in: [
            MatchStatus.pending,
            MatchStatus.active_sandbox,
            MatchStatus.wall_broken,
          ],
        },
        OR: [{ user_a_id: { in: userIds } }, { user_b_id: { in: userIds } }],
      },
      select: {
        user_a_id: true,
        user_b_id: true,
      },
    });

    return new Set(
      existingMatches.map((item) => {
        const [a, b] = this.canonicalPair(item.user_a_id, item.user_b_id);
        return `${a}:${b}`;
      }),
    );
  }

  private groupUsersByCity(users: UserForMatching[]) {
    const map = new Map<string, UserForMatching[]>();
    for (const user of users) {
      const city = user.profile?.city?.trim();
      if (!city) {
        continue;
      }
      const group = map.get(city) || [];
      group.push(user);
      map.set(city, group);
    }
    return map;
  }

  private canonicalPair(firstId: string, secondId: string): [string, string] {
    return firstId < secondId ? [firstId, secondId] : [secondId, firstId];
  }

  private getHiddenWeight(
    tags: Array<{ type: UserTagType; tag_name: string; weight: number }>,
    key: string,
  ) {
    const matched = tags.find(
      (item) => item.type === UserTagType.HIDDEN_SYSTEM && item.tag_name === key,
    );
    return this.clamp(matched?.weight ?? 1, 0, 10);
  }

  private canMatchByRiskTier(firstScore: number, secondScore: number) {
    const firstTier = this.toRiskTier(firstScore);
    const secondTier = this.toRiskTier(secondScore);

    if (firstTier === 2 || secondTier === 2) {
      return firstTier === secondTier;
    }
    return true;
  }

  private toRiskTier(score: number) {
    if (score >= 7) {
      return 2;
    }
    if (score >= 4) {
      return 1;
    }
    return 0;
  }

  private computeTagOverlap(
    firstTags: Array<{ type: UserTagType; tag_name: string; weight: number }>,
    secondTags: Array<{ type: UserTagType; tag_name: string; weight: number }>,
  ) {
    const firstMap = this.buildTagWeightMap(firstTags);
    const secondMap = this.buildTagWeightMap(secondTags);
    const keys = new Set([...firstMap.keys(), ...secondMap.keys()]);

    let numerator = 0;
    let denominator = 0;

    for (const key of keys) {
      const left = firstMap.get(key) || 0;
      const right = secondMap.get(key) || 0;
      numerator += Math.min(left, right);
      denominator += Math.max(left, right);
    }

    if (denominator <= 0) {
      return 0;
    }
    return this.clamp(numerator / denominator, 0, 1);
  }

  private buildTagWeightMap(
    tags: Array<{ type: UserTagType; tag_name: string; weight: number }>,
  ) {
    const map = new Map<string, number>();
    for (const tag of tags) {
      const normalized =
        tag.type === UserTagType.PUBLIC_VISIBLE
          ? this.clamp(tag.weight, 0, 1)
          : this.clamp(tag.weight / 10, 0, 1) * 0.9;
      const previous = map.get(tag.tag_name) || 0;
      map.set(tag.tag_name, previous + normalized);
    }
    return map;
  }

  private computeFinalScore(
    overlapSimilarity: number,
    vectorSimilarity: number | null,
    firstHarassment: number,
    secondHarassment: number,
  ) {
    const base = vectorSimilarity ?? overlapSimilarity;
    const blended = 0.65 * base + 0.35 * overlapSimilarity;
    const riskPenalty = ((firstHarassment + secondHarassment) / 20) * 28;
    return this.clampInt(Math.round(blended * 100 - riskPenalty), 0, 100);
  }

  private async computeVectorSimilarity(firstUserId: string, secondUserId: string) {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ similarity: number | null }>>`
        WITH first_vector AS (
          SELECT AVG("embedding") AS vector
          FROM "user_tags"
          WHERE "user_id" = ${firstUserId}::uuid
            AND "embedding" IS NOT NULL
        ),
        second_vector AS (
          SELECT AVG("embedding") AS vector
          FROM "user_tags"
          WHERE "user_id" = ${secondUserId}::uuid
            AND "embedding" IS NOT NULL
        )
        SELECT
          CASE
            WHEN first_vector.vector IS NULL OR second_vector.vector IS NULL THEN NULL
            ELSE 1 - (first_vector.vector <=> second_vector.vector)
          END AS similarity
        FROM first_vector, second_vector;
      `;

      const value = rows[0]?.similarity;
      if (value === null || value === undefined) {
        return null;
      }
      if (!Number.isFinite(value)) {
        return null;
      }
      return this.clamp(Number(value), 0, 1);
    } catch (error) {
      this.logger.warn(`vector similarity failed: ${(error as Error).message}`);
      return null;
    }
  }

  private async generateMatchReason(
    firstTags: Array<{ type: UserTagType; tag_name: string; weight: number }>,
    secondTags: Array<{ type: UserTagType; tag_name: string; weight: number }>,
    score: number,
    city: string,
  ) {
    const firstPublic = firstTags
      .filter((item) => item.type === UserTagType.PUBLIC_VISIBLE)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4)
      .map((item) => item.tag_name);
    const secondPublic = secondTags
      .filter((item) => item.type === UserTagType.PUBLIC_VISIBLE)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4)
      .map((item) => item.tag_name);

    const defaultPrompt = [
      '你是匿名交友平台的匹配理由生成器。',
      '请基于双方公开标签输出一句中文匹配理由。',
      '要求：',
      '- 20 到 45 个中文字符',
      '- 不包含隐私字段',
      '- 不提及隐藏标签',
      '- 语气自然，不模板化',
      '只输出 JSON：{"reason":"..."}',
    ].join('\n');
    const basePrompt = await this.promptTemplateService.getPrompt('match.reason', defaultPrompt);

    const payload = await this.callOpenAiJson<{
      reason?: string;
    }>(
      [
        basePrompt,
        `城市: ${city}`,
        `匹配分数: ${score}`,
        `A 标签: ${firstPublic.join('、') || '暂无'}`,
        `B 标签: ${secondPublic.join('、') || '暂无'}`,
      ].join('\n'),
      {
        feature: 'match.reason',
        promptKey: 'match.reason',
      },
    );

    const reason = payload?.reason?.trim();
    if (!reason) {
      return this.fallbackMatchReason(firstPublic, secondPublic, score, city);
    }
    return reason.slice(0, 90);
  }

  private fallbackMatchReason(
    firstTags: string[],
    secondTags: string[],
    score: number,
    city: string,
  ) {
    const shared = firstTags.find((item) => secondTags.includes(item));
    if (shared) {
      return `你们同在${city}，且都偏向“${shared}”式交流，当前共鸣分约 ${score}。`;
    }
    const left = firstTags[0] || '真诚表达';
    const right = secondTags[0] || '稳定沟通';
    return `你们同在${city}，一方偏向“${left}”，另一方偏向“${right}”，组合互补度较高。`;
  }

  private async callOpenAiJson<T>(
    prompt: string,
    options: {
      feature: string;
      promptKey: string;
      userId?: string;
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
          temperature: 0.6,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'You are a strict JSON generator. Output one JSON object only.',
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
        this.logger.warn(`match reason failed: ${response.status} ${detail}`);
        await this.serverLogService.warn('match.openai.failed', 'openai call failed', {
          feature: options.feature,
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

      return this.safeParseJson(content) as T;
    } catch (error) {
      this.logger.warn(`match reason error: ${(error as Error).message}`);
      await this.serverLogService.warn('match.openai.error', 'openai call error', {
        feature: options.feature,
        error: (error as Error).message,
      });
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

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  private clampInt(value: number, min: number, max: number) {
    return Math.round(this.clamp(value, min, max));
  }
}

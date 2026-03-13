"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MatchEngineService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchEngineService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const admin_config_service_1 = require("../admin/admin-config.service");
const prisma_service_1 = require("../prisma/prisma.service");
const ai_usage_service_1 = require("../telemetry/ai-usage.service");
const prompt_template_service_1 = require("../telemetry/prompt-template.service");
const server_log_service_1 = require("../telemetry/server-log.service");
let MatchEngineService = MatchEngineService_1 = class MatchEngineService {
    prisma;
    adminConfigService;
    promptTemplateService;
    aiUsageService;
    serverLogService;
    logger = new common_1.Logger(MatchEngineService_1.name);
    constructor(prisma, adminConfigService, promptTemplateService, aiUsageService, serverLogService) {
        this.prisma = prisma;
        this.adminConfigService = adminConfigService;
        this.promptTemplateService = promptTemplateService;
        this.aiUsageService = aiUsageService;
        this.serverLogService = serverLogService;
    }
    async run(body) {
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
                            in: [client_1.UserTagType.PUBLIC_VISIBLE, client_1.UserTagType.HIDDEN_SYSTEM],
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
        const candidates = [];
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
                    const finalScore = this.computeFinalScore(overlapSimilarity, vectorSimilarity, firstHarassment, secondHarassment);
                    if (finalScore < minScore) {
                        continue;
                    }
                    const reason = await this.generateMatchReason(first.tags, second.tags, finalScore, cityName);
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
        const perUserCounter = new Map();
        const created = [];
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
            }
            else {
                const match = await this.prisma.match.create({
                    data: {
                        user_a_id: candidate.userAId,
                        user_b_id: candidate.userBId,
                        status: client_1.MatchStatus.pending,
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
    async getUserMatches(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found.');
        }
        const matches = await this.prisma.match.findMany({
            where: {
                status: {
                    in: [
                        client_1.MatchStatus.pending,
                        client_1.MatchStatus.active_sandbox,
                        client_1.MatchStatus.wall_broken,
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
        const counterpartIds = Array.from(new Set(matches.map((item) => item.user_a_id === userId ? item.user_b_id : item.user_a_id)));
        const [counterpartTags, counterpartProfiles] = await Promise.all([
            this.prisma.userTag.findMany({
                where: {
                    user_id: { in: counterpartIds },
                    type: client_1.UserTagType.PUBLIC_VISIBLE,
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
        const tagMap = new Map();
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
        const profileMap = new Map(counterpartProfiles.map((profile) => [
            profile.user_id,
            {
                city: profile.city,
                anonymous_name: profile.anonymous_name,
                anonymous_avatar: profile.anonymous_avatar,
            },
        ]));
        return {
            user_id: userId,
            total_matches: matches.length,
            matches: matches.map((item) => {
                const counterpartId = item.user_a_id === userId ? item.user_b_id : item.user_a_id;
                return {
                    match_id: item.id,
                    status: item.status,
                    resonance_score: item.resonance_score,
                    ai_match_reason: item.ai_match_reason ||
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
    async loadExistingPairSet(userIds) {
        const existingMatches = await this.prisma.match.findMany({
            where: {
                status: {
                    in: [
                        client_1.MatchStatus.pending,
                        client_1.MatchStatus.active_sandbox,
                        client_1.MatchStatus.wall_broken,
                    ],
                },
                OR: [{ user_a_id: { in: userIds } }, { user_b_id: { in: userIds } }],
            },
            select: {
                user_a_id: true,
                user_b_id: true,
            },
        });
        return new Set(existingMatches.map((item) => {
            const [a, b] = this.canonicalPair(item.user_a_id, item.user_b_id);
            return `${a}:${b}`;
        }));
    }
    groupUsersByCity(users) {
        const map = new Map();
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
    canonicalPair(firstId, secondId) {
        return firstId < secondId ? [firstId, secondId] : [secondId, firstId];
    }
    getHiddenWeight(tags, key) {
        const matched = tags.find((item) => item.type === client_1.UserTagType.HIDDEN_SYSTEM && item.tag_name === key);
        return this.clamp(matched?.weight ?? 1, 0, 10);
    }
    canMatchByRiskTier(firstScore, secondScore) {
        const firstTier = this.toRiskTier(firstScore);
        const secondTier = this.toRiskTier(secondScore);
        if (firstTier === 2 || secondTier === 2) {
            return firstTier === secondTier;
        }
        return true;
    }
    toRiskTier(score) {
        if (score >= 7) {
            return 2;
        }
        if (score >= 4) {
            return 1;
        }
        return 0;
    }
    computeTagOverlap(firstTags, secondTags) {
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
    buildTagWeightMap(tags) {
        const map = new Map();
        for (const tag of tags) {
            const normalized = tag.type === client_1.UserTagType.PUBLIC_VISIBLE
                ? this.clamp(tag.weight, 0, 1)
                : this.clamp(tag.weight / 10, 0, 1) * 0.9;
            const previous = map.get(tag.tag_name) || 0;
            map.set(tag.tag_name, previous + normalized);
        }
        return map;
    }
    computeFinalScore(overlapSimilarity, vectorSimilarity, firstHarassment, secondHarassment) {
        const base = vectorSimilarity ?? overlapSimilarity;
        const blended = 0.65 * base + 0.35 * overlapSimilarity;
        const riskPenalty = ((firstHarassment + secondHarassment) / 20) * 28;
        return this.clampInt(Math.round(blended * 100 - riskPenalty), 0, 100);
    }
    async computeVectorSimilarity(firstUserId, secondUserId) {
        try {
            const rows = await this.prisma.$queryRaw `
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
        }
        catch (error) {
            this.logger.warn(`vector similarity failed: ${error.message}`);
            return null;
        }
    }
    async generateMatchReason(firstTags, secondTags, score, city) {
        const firstPublic = firstTags
            .filter((item) => item.type === client_1.UserTagType.PUBLIC_VISIBLE)
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 4)
            .map((item) => item.tag_name);
        const secondPublic = secondTags
            .filter((item) => item.type === client_1.UserTagType.PUBLIC_VISIBLE)
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
        const payload = await this.callOpenAiJson([
            basePrompt,
            `城市: ${city}`,
            `匹配分数: ${score}`,
            `A 标签: ${firstPublic.join('、') || '暂无'}`,
            `B 标签: ${secondPublic.join('、') || '暂无'}`,
        ].join('\n'), {
            feature: 'match.reason',
            promptKey: 'match.reason',
        });
        const reason = payload?.reason?.trim();
        if (!reason) {
            return this.fallbackMatchReason(firstPublic, secondPublic, score, city);
        }
        return reason.slice(0, 90);
    }
    fallbackMatchReason(firstTags, secondTags, score, city) {
        const shared = firstTags.find((item) => secondTags.includes(item));
        if (shared) {
            return `你们同在${city}，且都偏向“${shared}”式交流，当前共鸣分约 ${score}。`;
        }
        const left = firstTags[0] || '真诚表达';
        const right = secondTags[0] || '稳定沟通';
        return `你们同在${city}，一方偏向“${left}”，另一方偏向“${right}”，组合互补度较高。`;
    }
    async callOpenAiJson(prompt, options) {
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
            const payload = (await response.json());
            const usage = payload.usage;
            await this.aiUsageService.logGeneration({
                userId: options.userId,
                feature: options.feature,
                promptKey: options.promptKey,
                provider: 'openai',
                model,
                inputTokens: usage?.prompt_tokens || 0,
                outputTokens: usage?.completion_tokens || 0,
                totalTokens: usage?.total_tokens ||
                    (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0),
            });
            const content = payload.choices?.[0]?.message?.content?.trim();
            if (!content) {
                return null;
            }
            return this.safeParseJson(content);
        }
        catch (error) {
            this.logger.warn(`match reason error: ${error.message}`);
            await this.serverLogService.warn('match.openai.error', 'openai call error', {
                feature: options.feature,
                error: error.message,
            });
            return null;
        }
    }
    safeParseJson(raw) {
        const text = raw
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();
        try {
            return JSON.parse(text);
        }
        catch {
            return null;
        }
    }
    clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }
    clampInt(value, min, max) {
        return Math.round(this.clamp(value, min, max));
    }
};
exports.MatchEngineService = MatchEngineService;
exports.MatchEngineService = MatchEngineService = MatchEngineService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        admin_config_service_1.AdminConfigService,
        prompt_template_service_1.PromptTemplateService,
        ai_usage_service_1.AiUsageService,
        server_log_service_1.ServerLogService])
], MatchEngineService);
//# sourceMappingURL=match-engine.service.js.map
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
var SandboxService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const admin_config_service_1 = require("../admin/admin-config.service");
const prisma_service_1 = require("../prisma/prisma.service");
const ai_usage_service_1 = require("../telemetry/ai-usage.service");
const prompt_template_service_1 = require("../telemetry/prompt-template.service");
const server_log_service_1 = require("../telemetry/server-log.service");
let SandboxService = SandboxService_1 = class SandboxService {
    prisma;
    adminConfigService;
    promptTemplateService;
    aiUsageService;
    serverLogService;
    logger = new common_1.Logger(SandboxService_1.name);
    constructor(prisma, adminConfigService, promptTemplateService, aiUsageService, serverLogService) {
        this.prisma = prisma;
        this.adminConfigService = adminConfigService;
        this.promptTemplateService = promptTemplateService;
        this.aiUsageService = aiUsageService;
        this.serverLogService = serverLogService;
    }
    async ensureUserExists(userId) {
        const found = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true },
        });
        return Boolean(found);
    }
    async assertMatchParticipant(matchId, userId) {
        const info = await this.getMatchParticipantInfo(matchId, userId);
        return {
            match_id: info.matchId,
            status: info.status,
            counterpart_user_id: info.receiverId,
            resonance_score: info.resonanceScore,
            wall_ready: info.resonanceScore >= 100,
            wall_broken: info.status === client_1.MatchStatus.wall_broken,
        };
    }
    async getMatchMessages(matchId, userId, limit) {
        const normalizedLimit = Math.max(1, Math.min(limit, 200));
        const match = await this.prisma.match.findUnique({
            where: { id: matchId },
            select: {
                id: true,
                user_a_id: true,
                user_b_id: true,
            },
        });
        if (!match) {
            throw new common_1.NotFoundException('会话不存在。');
        }
        if (userId && userId !== match.user_a_id && userId !== match.user_b_id) {
            throw new common_1.ForbiddenException('你无权访问该会话。');
        }
        const rows = await this.prisma.sandboxMessage.findMany({
            where: { match_id: matchId },
            orderBy: { created_at: 'desc' },
            take: normalizedLimit,
            select: {
                id: true,
                sender_id: true,
                original_text: true,
                ai_rewritten_text: true,
                ai_action: true,
                hidden_tag_updates: true,
                created_at: true,
            },
        });
        return {
            match_id: matchId,
            total: rows.length,
            messages: rows
                .reverse()
                .map((item) => ({
                message_id: item.id,
                sender_id: item.sender_id,
                original_text: item.original_text,
                ai_rewritten_text: item.ai_rewritten_text,
                ai_action: item.ai_action,
                hidden_tag_updates: item.hidden_tag_updates,
                created_at: item.created_at.toISOString(),
            })),
        };
    }
    async getWallState(matchId, userId) {
        const info = await this.getMatchParticipantInfo(matchId, userId);
        return this.buildWallStateFromInfo(info);
    }
    async submitWallDecision(input) {
        const info = await this.getMatchParticipantInfo(input.matchId, input.userId);
        if (info.status === client_1.MatchStatus.rejected) {
            throw new common_1.BadRequestException('该会话已被拒绝。');
        }
        if (info.status !== client_1.MatchStatus.wall_broken && info.resonanceScore < 100) {
            throw new common_1.BadRequestException('共鸣值达到 100 后才可发起破壁。');
        }
        if (info.status === client_1.MatchStatus.wall_broken) {
            return this.buildWallStateFromInfo(info);
        }
        const nextConsents = {
            ...info.wallBreakConsents,
            [input.userId]: Boolean(input.accept),
        };
        const userAAccepted = nextConsents[info.userAId] === true;
        const userBAccepted = nextConsents[info.userBId] === true;
        const bothAccepted = userAAccepted && userBAccepted;
        if (!bothAccepted) {
            await this.prisma.match.update({
                where: { id: info.matchId },
                data: {
                    wall_break_consents: nextConsents,
                },
            });
        }
        else {
            await this.prisma.$transaction(async (tx) => {
                await tx.match.update({
                    where: { id: info.matchId },
                    data: {
                        status: client_1.MatchStatus.wall_broken,
                        wall_break_consents: nextConsents,
                        wall_broken_at: new Date(),
                    },
                });
                for (const userId of [info.userAId, info.userBId]) {
                    await tx.userProfile.upsert({
                        where: { user_id: userId },
                        create: {
                            user_id: userId,
                            is_wall_broken: true,
                        },
                        update: {
                            is_wall_broken: true,
                        },
                    });
                }
            });
        }
        const refreshed = await this.getMatchParticipantInfo(info.matchId, input.userId);
        return this.buildWallStateFromInfo(refreshed);
    }
    async processMessage(input) {
        const text = input.text.trim();
        if (!text) {
            throw new common_1.BadRequestException('消息内容不能为空。');
        }
        if (text.length > 4000) {
            throw new common_1.BadRequestException('消息过长，请控制在 4000 字以内。');
        }
        const participant = await this.getMatchParticipantInfo(input.matchId, input.senderId);
        if (participant.status === client_1.MatchStatus.wall_broken) {
            throw new common_1.BadRequestException('该会话已破壁，请切换为直聊发送。');
        }
        if (participant.status === client_1.MatchStatus.rejected) {
            throw new common_1.BadRequestException('该会话已被拒绝。');
        }
        const [senderTags, receiverTags] = await Promise.all([
            this.prisma.userTag.findMany({
                where: { user_id: participant.senderId },
                select: {
                    type: true,
                    tag_name: true,
                    weight: true,
                    ai_justification: true,
                },
            }),
            this.prisma.userTag.findMany({
                where: { user_id: participant.receiverId },
                select: {
                    type: true,
                    tag_name: true,
                    weight: true,
                    ai_justification: true,
                },
            }),
        ]);
        const decision = await this.runMiddleware({
            text,
            senderId: participant.senderId,
            receiverId: participant.receiverId,
            senderTags,
            receiverTags,
        });
        const hiddenTagUpdates = this.normalizeHiddenTagUpdateMap(decision.hiddenTagUpdates);
        const message = await this.prisma.sandboxMessage.create({
            data: {
                match_id: participant.matchId,
                sender_id: participant.senderId,
                original_text: text,
                ai_rewritten_text: decision.rewrittenText,
                ai_action: decision.aiAction,
                hidden_tag_updates: Object.keys(hiddenTagUpdates).length > 0
                    ? hiddenTagUpdates
                    : client_1.Prisma.JsonNull,
            },
            select: {
                id: true,
                created_at: true,
            },
        });
        let resonanceScore = participant.resonanceScore;
        let wallReady = false;
        if (decision.aiAction === 'blocked') {
            const updates = Object.keys(hiddenTagUpdates).length > 0
                ? hiddenTagUpdates
                : { harassment_tendency: 1.2 };
            await this.applyHiddenTagUpdates(participant.senderId, updates, decision.reason);
        }
        else {
            resonanceScore = Math.min(participant.resonanceScore + 5, 100);
            wallReady = resonanceScore >= 100;
            const nextStatus = participant.status === client_1.MatchStatus.pending
                ? client_1.MatchStatus.active_sandbox
                : participant.status;
            await this.prisma.match.update({
                where: { id: participant.matchId },
                data: {
                    resonance_score: resonanceScore,
                    status: nextStatus,
                },
            });
        }
        return {
            matchId: participant.matchId,
            senderId: participant.senderId,
            receiverId: participant.receiverId,
            messageId: message.id,
            originalText: text,
            rewrittenText: decision.rewrittenText,
            aiAction: decision.aiAction,
            hiddenTagUpdates,
            reason: decision.reason,
            delivered: decision.aiAction !== 'blocked',
            resonanceScore,
            wallReady,
            createdAt: message.created_at.toISOString(),
        };
    }
    async processDirectMessage(input) {
        const text = input.text.trim();
        if (!text) {
            throw new common_1.BadRequestException('消息内容不能为空。');
        }
        if (text.length > 4000) {
            throw new common_1.BadRequestException('消息过长，请控制在 4000 字以内。');
        }
        const participant = await this.getMatchParticipantInfo(input.matchId, input.senderId);
        if (participant.status !== client_1.MatchStatus.wall_broken) {
            throw new common_1.BadRequestException('仅在破壁后才可使用直聊。');
        }
        const message = await this.prisma.sandboxMessage.create({
            data: {
                match_id: participant.matchId,
                sender_id: participant.senderId,
                original_text: text,
                ai_rewritten_text: text,
                ai_action: client_1.AiAction.passed,
                hidden_tag_updates: client_1.Prisma.JsonNull,
            },
            select: {
                id: true,
                created_at: true,
            },
        });
        return {
            matchId: participant.matchId,
            senderId: participant.senderId,
            receiverId: participant.receiverId,
            messageId: message.id,
            text,
            createdAt: message.created_at.toISOString(),
        };
    }
    async buildWallStateFromInfo(info) {
        const userAAccepted = info.wallBreakConsents[info.userAId] === true;
        const userBAccepted = info.wallBreakConsents[info.userBId] === true;
        const requesterAccepted = info.wallBreakConsents[info.senderId] === true;
        const counterpartAccepted = info.wallBreakConsents[info.receiverId] === true;
        const profiles = await this.getProfilePair(info.userAId, info.userBId);
        const selfProfile = profiles.get(info.senderId) || {
            userId: info.senderId,
            anonymousName: null,
            anonymousAvatar: null,
            realName: null,
            realAvatar: null,
        };
        const counterpartProfile = profiles.get(info.receiverId) || {
            userId: info.receiverId,
            anonymousName: null,
            anonymousAvatar: null,
            realName: null,
            realAvatar: null,
        };
        return {
            matchId: info.matchId,
            status: info.status,
            resonanceScore: info.resonanceScore,
            wallReady: info.resonanceScore >= 100,
            wallBroken: info.status === client_1.MatchStatus.wall_broken,
            requesterAccepted,
            counterpartAccepted,
            consents: {
                userAId: info.userAId,
                userBId: info.userBId,
                userAAccepted,
                userBAccepted,
            },
            selfProfile,
            counterpartProfile,
        };
    }
    async getProfilePair(userAId, userBId) {
        const rows = await this.prisma.userProfile.findMany({
            where: {
                user_id: {
                    in: [userAId, userBId],
                },
            },
            select: {
                user_id: true,
                anonymous_name: true,
                anonymous_avatar: true,
                real_name: true,
                real_avatar: true,
            },
        });
        const map = new Map();
        for (const row of rows) {
            map.set(row.user_id, {
                userId: row.user_id,
                anonymousName: row.anonymous_name,
                anonymousAvatar: row.anonymous_avatar,
                realName: row.real_name,
                realAvatar: row.real_avatar,
            });
        }
        return map;
    }
    async getMatchParticipantInfo(matchId, senderId) {
        const match = await this.prisma.match.findUnique({
            where: { id: matchId },
            select: {
                id: true,
                status: true,
                user_a_id: true,
                user_b_id: true,
                resonance_score: true,
                wall_break_consents: true,
            },
        });
        if (!match) {
            throw new common_1.NotFoundException('会话不存在。');
        }
        if (senderId !== match.user_a_id && senderId !== match.user_b_id) {
            throw new common_1.ForbiddenException('当前用户不在该会话中。');
        }
        return {
            matchId: match.id,
            status: match.status,
            userAId: match.user_a_id,
            userBId: match.user_b_id,
            senderId,
            receiverId: senderId === match.user_a_id ? match.user_b_id : match.user_a_id,
            resonanceScore: match.resonance_score,
            wallBreakConsents: this.parseConsentMap(match.wall_break_consents),
        };
    }
    parseConsentMap(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }
        const input = value;
        const output = {};
        for (const [key, raw] of Object.entries(input)) {
            output[key] = raw === true;
        }
        return output;
    }
    async runMiddleware(input) {
        const aiConfig = await this.adminConfigService.getAiConfig();
        const apiKey = aiConfig.openaiApiKey;
        if (!apiKey) {
            return this.fallbackMiddleware(input.text);
        }
        const senderPublic = input.senderTags
            .filter((item) => item.type === client_1.UserTagType.PUBLIC_VISIBLE)
            .slice(0, 8);
        const senderHidden = input.senderTags
            .filter((item) => item.type === client_1.UserTagType.HIDDEN_SYSTEM)
            .slice(0, 8);
        const receiverPublic = input.receiverTags
            .filter((item) => item.type === client_1.UserTagType.PUBLIC_VISIBLE)
            .slice(0, 8);
        const fallbackPrompt = [
            'You are MindWall sandbox middleware.',
            'Evaluate user message for safety and rewrite if needed.',
            'Return strict JSON only with this schema:',
            '{',
            '  "ai_action":"passed|blocked|modified",',
            '  "ai_rewritten_text":"...",',
            '  "hidden_tag_updates":{"harassment_tendency":1.2},',
            '  "reason":"short reason"',
            '}',
            'Rules:',
            '- Block if asks for contact exchange, sexual solicitation, insults, threats, coercion.',
            '- If safe but rough, rewrite to respectful tone.',
            '- Keep semantic intent while rewriting.',
            '- hidden_tag_updates values are deltas in range [-2.5, 2.5].',
        ].join('\n');
        const basePrompt = await this.promptTemplateService.getPrompt('sandbox.middleware', fallbackPrompt);
        const prompt = [
            basePrompt,
            `sender_id: ${input.senderId}`,
            `receiver_id: ${input.receiverId}`,
            `sender_public_tags: ${JSON.stringify(senderPublic)}`,
            `sender_hidden_tags: ${JSON.stringify(senderHidden)}`,
            `receiver_public_tags: ${JSON.stringify(receiverPublic)}`,
            `message: ${input.text}`,
        ].join('\n');
        const result = await this.callOpenAiJson(prompt, {
            feature: 'sandbox.middleware',
            promptKey: 'sandbox.middleware',
            userId: input.senderId,
        });
        if (!result) {
            return this.fallbackMiddleware(input.text);
        }
        return this.normalizeMiddlewareDecision({
            aiAction: result.ai_action,
            rewrittenText: result.ai_rewritten_text,
            reason: result.reason,
            hiddenTagUpdates: result.hidden_tag_updates || {},
            originalText: input.text,
        });
    }
    normalizeMiddlewareDecision(input) {
        const action = input.aiAction === 'blocked' || input.aiAction === 'modified'
            ? input.aiAction
            : 'passed';
        const rewrittenBase = (input.rewrittenText || '').trim();
        const rewrittenText = action === 'blocked'
            ? rewrittenBase || '消息已被安全中间层拦截。'
            : rewrittenBase || input.originalText;
        return {
            aiAction: action,
            rewrittenText: rewrittenText.slice(0, 2000),
            hiddenTagUpdates: input.hiddenTagUpdates || {},
            reason: (input.reason || '安全中间层判定').slice(0, 220),
        };
    }
    fallbackMiddleware(text) {
        const contactPattern = /(wechat|vx|wx|telegram|whatsapp|line|qq|contact|phone|number|email|加我|微信|手机号|电话号码|联系方式|私聊外站|二维码|群号|\b\d{7,}\b)/i;
        const sexualPattern = /(nude|sex|escort|色情|裸照|约炮|性暗示|私密照|开房|做爱)/i;
        const abusePattern = /(fuck\s*you|bitch|idiot|loser|stupid|傻逼|废物|贱人|滚开|脑残|去死)/i;
        const normalized = text.trim().replace(/\s+/g, ' ');
        if (contactPattern.test(normalized)) {
            return {
                aiAction: 'blocked',
                rewrittenText: '消息已被安全中间层拦截。',
                hiddenTagUpdates: { harassment_tendency: 1.2 },
                reason: 'blocked: attempted off-platform contact exchange',
            };
        }
        if (sexualPattern.test(normalized)) {
            return {
                aiAction: 'blocked',
                rewrittenText: '消息已被安全中间层拦截。',
                hiddenTagUpdates: { harassment_tendency: 1.8 },
                reason: 'blocked: sexual solicitation detected',
            };
        }
        if (abusePattern.test(normalized)) {
            return {
                aiAction: 'blocked',
                rewrittenText: '消息已被安全中间层拦截。',
                hiddenTagUpdates: { harassment_tendency: 1.5, empathy: -0.8 },
                reason: 'blocked: abusive language detected',
            };
        }
        const softened = this.softenTone(normalized);
        if (softened !== normalized) {
            return {
                aiAction: 'modified',
                rewrittenText: softened,
                hiddenTagUpdates: {},
                reason: 'modified: softened tone for respectful delivery',
            };
        }
        return {
            aiAction: 'passed',
            rewrittenText: normalized,
            hiddenTagUpdates: {},
            reason: 'passed: no violation found',
        };
    }
    softenTone(text) {
        let next = text;
        next = next.replace(/你必须/g, '你愿不愿意');
        next = next.replace(/赶紧/g, '方便的话尽快');
        next = next.replace(/立刻/g, '尽快');
        next = next.replace(/!!+/g, '。');
        next = next.replace(/\?\?+/g, '？');
        next = next.replace(/\s{2,}/g, ' ');
        if (!/[.!?。！？]$/.test(next)) {
            next = `${next}。`;
        }
        return next.trim();
    }
    normalizeHiddenTagUpdateMap(raw) {
        const output = {};
        for (const [key, value] of Object.entries(raw)) {
            const normalizedKey = key
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_]+/g, '_')
                .slice(0, 64);
            if (!normalizedKey) {
                continue;
            }
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
                continue;
            }
            output[normalizedKey] = Math.max(-2.5, Math.min(2.5, Number(numeric.toFixed(3))));
        }
        return output;
    }
    async applyHiddenTagUpdates(userId, deltas, reason) {
        for (const [tagName, delta] of Object.entries(deltas)) {
            const existing = await this.prisma.userTag.findUnique({
                where: {
                    user_id_type_tag_name: {
                        user_id: userId,
                        type: client_1.UserTagType.HIDDEN_SYSTEM,
                        tag_name: tagName,
                    },
                },
                select: { weight: true },
            });
            const baseline = tagName === 'harassment_tendency' ? 1 : 5;
            const nextWeight = Math.max(0, Math.min(10, (existing?.weight ?? baseline) + delta));
            await this.prisma.userTag.upsert({
                where: {
                    user_id_type_tag_name: {
                        user_id: userId,
                        type: client_1.UserTagType.HIDDEN_SYSTEM,
                        tag_name: tagName,
                    },
                },
                create: {
                    user_id: userId,
                    type: client_1.UserTagType.HIDDEN_SYSTEM,
                    tag_name: tagName,
                    weight: Number(nextWeight.toFixed(3)),
                    ai_justification: `sandbox update: ${reason}`.slice(0, 280),
                },
                update: {
                    weight: Number(nextWeight.toFixed(3)),
                    ai_justification: `sandbox update: ${reason}`.slice(0, 280),
                },
            });
        }
    }
    async callOpenAiJson(prompt, options) {
        const aiConfig = await this.adminConfigService.getAiConfig();
        const apiKey = aiConfig.openaiApiKey;
        if (!apiKey) {
            return null;
        }
        const model = aiConfig.openaiModel;
        try {
            const response = await fetch(this.adminConfigService.getChatCompletionsUrl(aiConfig.openaiBaseUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.2,
                    response_format: { type: 'json_object' },
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a strict JSON generator. Output only one JSON object.',
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
                this.logger.warn(`OpenAI middleware failed: ${response.status} ${detail}`);
                await this.serverLogService.warn('sandbox.openai.failed', 'openai middleware failed', {
                    status: response.status,
                    feature: options.feature,
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
            const parsed = this.safeParseJson(content);
            return parsed;
        }
        catch (error) {
            this.logger.warn(`OpenAI middleware error: ${error.message}`);
            await this.serverLogService.warn('sandbox.openai.error', 'openai middleware error', {
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
};
exports.SandboxService = SandboxService;
exports.SandboxService = SandboxService = SandboxService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        admin_config_service_1.AdminConfigService,
        prompt_template_service_1.PromptTemplateService,
        ai_usage_service_1.AiUsageService,
        server_log_service_1.ServerLogService])
], SandboxService);
//# sourceMappingURL=sandbox.service.js.map
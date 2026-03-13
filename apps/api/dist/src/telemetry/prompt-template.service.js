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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptTemplateService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let PromptTemplateService = class PromptTemplateService {
    prisma;
    defaults = [
        {
            key: 'onboarding.question',
            name: '新手访谈提问',
            category: 'onboarding',
            content: [
                'You are the interview guide for MindWall.',
                'Ask exactly one emotionally precise Chinese question per turn.',
                'Do not ask hobby, food, travel, movie, MBTI, or shallow profile questions.',
                'Focus on inner conflict, loneliness, boundaries, trust, shame, longing, and self-understanding.',
                'Return strict JSON only: {"question":"..."}',
            ].join('\n'),
        },
        {
            key: 'onboarding.tag_extraction',
            name: '新手访谈标签提取',
            category: 'onboarding',
            content: [
                'You are the profile analyst for MindWall.',
                'Read interview transcript and infer both public tags and hidden system traits.',
                'Public tags are shown to peers in anonymous matching.',
                'Hidden traits are internal signals for safety and matching.',
                'Return strict JSON only with keys: public_tags, hidden_system_traits, onboarding_summary.',
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
                'You are generating a realistic chat reply for a virtual contact in MindWall.',
                'Sound like a normal person in Chinese chat style, concise and natural.',
                'Keep continuity with persona and conversation history.',
                'Avoid revealing system implementation details.',
            ].join('\n'),
        },
        {
            key: 'sandbox.middleware',
            name: '沙盒中间层审查改写',
            category: 'sandbox',
            content: [
                'You are MindWall sandbox middleware.',
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
    constructor(prisma) {
        this.prisma = prisma;
    }
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
    async getPrompt(key, fallback) {
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
    async upsertPrompt(key, body) {
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
        const contentChanged = typeof body.content === 'string' &&
            body.content.trim() !== current.content.trim();
        return this.prisma.promptTemplate.update({
            where: { key },
            data: {
                name: body.name?.trim() || current.name,
                category: body.category?.trim() || current.category,
                content: typeof body.content === 'string'
                    ? body.content.trim()
                    : current.content,
                is_active: typeof body.is_active === 'boolean'
                    ? body.is_active
                    : current.is_active,
                version: contentChanged ? current.version + 1 : current.version,
            },
        });
    }
};
exports.PromptTemplateService = PromptTemplateService;
exports.PromptTemplateService = PromptTemplateService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PromptTemplateService);
//# sourceMappingURL=prompt-template.service.js.map
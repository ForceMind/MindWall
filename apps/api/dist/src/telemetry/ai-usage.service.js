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
exports.AiUsageService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let AiUsageService = class AiUsageService {
    prisma;
    pricingPer1K = {
        'gpt-4.1-mini': { inputUsd: 0.0004, outputUsd: 0.0016 },
        'gpt-4.1': { inputUsd: 0.005, outputUsd: 0.015 },
        'text-embedding-3-small': { inputUsd: 0.00002, outputUsd: 0 },
        'text-embedding-3-large': { inputUsd: 0.00013, outputUsd: 0 },
    };
    constructor(prisma) {
        this.prisma = prisma;
    }
    async logGeneration(input) {
        const inputTokens = Math.max(0, Math.round(input.inputTokens || 0));
        const outputTokens = Math.max(0, Math.round(input.outputTokens || 0));
        const totalTokens = Math.max(0, Math.round(input.totalTokens === undefined
            ? inputTokens + outputTokens
            : input.totalTokens));
        const estimated = this.estimateCost(input.model, inputTokens, outputTokens);
        const metadata = input.metadata === null
            ? client_1.Prisma.JsonNull
            : input.metadata
                ? input.metadata
                : undefined;
        return this.prisma.aiGenerationLog.create({
            data: {
                user_id: input.userId || null,
                feature: input.feature.slice(0, 64),
                prompt_key: input.promptKey?.slice(0, 64) || null,
                provider: (input.provider || 'openai').slice(0, 32),
                model: input.model.slice(0, 128),
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                total_tokens: totalTokens,
                estimated_cost_usd: new client_1.Prisma.Decimal(estimated.toFixed(6)),
                metadata,
            },
        });
    }
    async getUsageOverview() {
        const [aggregate, totalRecords] = await Promise.all([
            this.prisma.aiGenerationLog.aggregate({
                _sum: {
                    input_tokens: true,
                    output_tokens: true,
                    total_tokens: true,
                    estimated_cost_usd: true,
                },
            }),
            this.prisma.aiGenerationLog.count(),
        ]);
        return {
            total_records: totalRecords,
            input_tokens: aggregate._sum.input_tokens || 0,
            output_tokens: aggregate._sum.output_tokens || 0,
            total_tokens: aggregate._sum.total_tokens || 0,
            estimated_cost_usd: Number(aggregate._sum.estimated_cost_usd || 0),
        };
    }
    async listRecords(page, limit) {
        const safePage = Math.max(1, Math.round(page || 1));
        const safeLimit = Math.max(1, Math.min(100, Math.round(limit || 20)));
        const skip = (safePage - 1) * safeLimit;
        const [total, records] = await Promise.all([
            this.prisma.aiGenerationLog.count(),
            this.prisma.aiGenerationLog.findMany({
                skip,
                take: safeLimit,
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    user_id: true,
                    feature: true,
                    prompt_key: true,
                    provider: true,
                    model: true,
                    input_tokens: true,
                    output_tokens: true,
                    total_tokens: true,
                    estimated_cost_usd: true,
                    metadata: true,
                    created_at: true,
                },
            }),
        ]);
        return {
            page: safePage,
            limit: safeLimit,
            total,
            records: records.map((item) => ({
                ...item,
                estimated_cost_usd: Number(item.estimated_cost_usd),
            })),
        };
    }
    estimateCost(model, inputTokens, outputTokens) {
        const price = this.pricingPer1K[model] || { inputUsd: 0.0006, outputUsd: 0.002 };
        const inputCost = (inputTokens / 1000) * price.inputUsd;
        const outputCost = (outputTokens / 1000) * price.outputUsd;
        return inputCost + outputCost;
    }
};
exports.AiUsageService = AiUsageService;
exports.AiUsageService = AiUsageService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AiUsageService);
//# sourceMappingURL=ai-usage.service.js.map
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
type UsageInput = {
    userId?: string | null;
    feature: string;
    promptKey?: string;
    provider?: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    metadata?: Record<string, unknown> | null;
};
export declare class AiUsageService {
    private readonly prisma;
    private readonly pricingPer1K;
    constructor(prisma: PrismaService);
    logGeneration(input: UsageInput): Promise<{
        id: string;
        feature: string;
        prompt_key: string | null;
        provider: string;
        model: string;
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
        estimated_cost_usd: Prisma.Decimal;
        metadata: Prisma.JsonValue | null;
        created_at: Date;
        user_id: string | null;
    }>;
    getUsageOverview(): Promise<{
        total_records: number;
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
        estimated_cost_usd: number;
    }>;
    listRecords(page: number, limit: number): Promise<{
        page: number;
        limit: number;
        total: number;
        records: {
            estimated_cost_usd: number;
            id: string;
            feature: string;
            prompt_key: string | null;
            provider: string;
            model: string;
            input_tokens: number;
            output_tokens: number;
            total_tokens: number;
            metadata: Prisma.JsonValue;
            created_at: Date;
            user_id: string | null;
        }[];
    }>;
    private estimateCost;
}
export {};

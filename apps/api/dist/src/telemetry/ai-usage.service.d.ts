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
        user_id: string | null;
        created_at: Date;
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
        summary: {
            total_input_tokens: number;
            total_output_tokens: number;
            total_tokens: number;
            total_estimated_cost_usd: number;
            unique_user_count: number;
        };
        records: {
            estimated_cost_usd: number;
            user_id: string | null;
            created_at: Date;
            id: string;
            feature: string;
            prompt_key: string | null;
            provider: string;
            model: string;
            input_tokens: number;
            output_tokens: number;
            total_tokens: number;
            metadata: Prisma.JsonValue;
        }[];
    }>;
    private estimateCost;
}
export {};

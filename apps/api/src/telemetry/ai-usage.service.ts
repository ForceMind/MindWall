import { Injectable } from '@nestjs/common';
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

@Injectable()
export class AiUsageService {
  private readonly pricingPer1K: Record<
    string,
    { inputUsd: number; outputUsd: number }
  > = {
    'gpt-4.1-mini': { inputUsd: 0.0004, outputUsd: 0.0016 },
    'gpt-4.1': { inputUsd: 0.005, outputUsd: 0.015 },
    'text-embedding-3-small': { inputUsd: 0.00002, outputUsd: 0 },
    'text-embedding-3-large': { inputUsd: 0.00013, outputUsd: 0 },
  };

  constructor(private readonly prisma: PrismaService) {}

  async logGeneration(input: UsageInput) {
    const inputTokens = Math.max(0, Math.round(input.inputTokens || 0));
    const outputTokens = Math.max(0, Math.round(input.outputTokens || 0));
    const totalTokens = Math.max(
      0,
      Math.round(
        input.totalTokens === undefined
          ? inputTokens + outputTokens
          : input.totalTokens,
      ),
    );
    const estimated = this.estimateCost(input.model, inputTokens, outputTokens);
    const metadata =
      input.metadata === null
        ? Prisma.JsonNull
        : input.metadata
          ? (input.metadata as Prisma.InputJsonValue)
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
        estimated_cost_usd: new Prisma.Decimal(estimated.toFixed(6)),
        metadata,
      },
    });
  }

  async getUsageOverview() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [aggregate, totalRecords, todayAggregate, todayRecords] = await Promise.all([
      this.prisma.aiGenerationLog.aggregate({
        _sum: {
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          estimated_cost_usd: true,
        },
      }),
      this.prisma.aiGenerationLog.count(),
      this.prisma.aiGenerationLog.aggregate({
        where: { created_at: { gte: todayStart } },
        _sum: {
          total_tokens: true,
          estimated_cost_usd: true,
        },
      }),
      this.prisma.aiGenerationLog.count({
        where: { created_at: { gte: todayStart } },
      }),
    ]);

    return {
      total_calls: totalRecords,
      total_input_tokens: aggregate._sum.input_tokens || 0,
      total_output_tokens: aggregate._sum.output_tokens || 0,
      total_tokens: aggregate._sum.total_tokens || 0,
      total_estimated_cost_usd: Number(aggregate._sum.estimated_cost_usd || 0),
      today_calls: todayRecords,
      today_tokens: todayAggregate._sum.total_tokens || 0,
      today_estimated_cost_usd: Number(todayAggregate._sum.estimated_cost_usd || 0),
    };
  }

  async listRecords(page: number, limit: number) {
    const safePage = Math.max(1, Math.round(page || 1));
    const safeLimit = Math.max(1, Math.min(100, Math.round(limit || 20)));
    const skip = (safePage - 1) * safeLimit;

    const [total, records, aggregate, uniqueUsers] = await Promise.all([
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
      this.prisma.aiGenerationLog.aggregate({
        _sum: {
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          estimated_cost_usd: true,
        },
      }),
      this.prisma.aiGenerationLog.groupBy({
        by: ['user_id'],
        where: {
          user_id: {
            not: null,
          },
        },
      }),
    ]);

    return {
      page: safePage,
      limit: safeLimit,
      total,
      summary: {
        total_input_tokens: aggregate._sum.input_tokens || 0,
        total_output_tokens: aggregate._sum.output_tokens || 0,
        total_tokens: aggregate._sum.total_tokens || 0,
        total_estimated_cost_usd: Number(aggregate._sum.estimated_cost_usd || 0),
        unique_user_count: uniqueUsers.length,
      },
      records: records.map((item) => ({
        ...item,
        estimated_cost_usd: Number(item.estimated_cost_usd),
      })),
    };
  }

  private estimateCost(model: string, inputTokens: number, outputTokens: number) {
    const price = this.pricingPer1K[model] || { inputUsd: 0.0006, outputUsd: 0.002 };
    const inputCost = (inputTokens / 1000) * price.inputUsd;
    const outputCost = (outputTokens / 1000) * price.outputUsd;
    return inputCost + outputCost;
  }
}

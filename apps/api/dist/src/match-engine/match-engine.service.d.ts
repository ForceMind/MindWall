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
export declare class MatchEngineService {
    private readonly prisma;
    private readonly adminConfigService;
    private readonly promptTemplateService;
    private readonly aiUsageService;
    private readonly serverLogService;
    private readonly logger;
    constructor(prisma: PrismaService, adminConfigService: AdminConfigService, promptTemplateService: PromptTemplateService, aiUsageService: AiUsageService, serverLogService: ServerLogService);
    run(body: RunMatchEngineBody): Promise<{
        status: string;
        city_scope: string;
        considered_users: number;
        candidate_pairs: number;
        created_matches: number;
        dry_run: boolean;
        matches: {
            match_id: string;
            user_a_id: string;
            user_b_id: string;
            resonance_score: number;
            ai_match_reason: string;
            city: string;
        }[];
    }>;
    getUserMatches(userId: string): Promise<{
        user_id: string;
        total_matches: number;
        matches: {
            match_id: string;
            status: import("@prisma/client").$Enums.MatchStatus;
            resonance_score: number;
            ai_match_reason: string;
            counterpart: {
                user_id: string;
                city: string | null;
                anonymous_name: string | null;
                anonymous_avatar: string | null;
                public_tags: {
                    tag_name: string;
                    weight: number;
                    ai_justification: string;
                }[];
            };
        }[];
    }>;
    private loadExistingPairSet;
    private groupUsersByCity;
    private canonicalPair;
    private getHiddenWeight;
    private canMatchByRiskTier;
    private toRiskTier;
    private computeTagOverlap;
    private buildTagWeightMap;
    private computeFinalScore;
    private computeVectorSimilarity;
    private generateMatchReason;
    private fallbackMatchReason;
    private callOpenAiJson;
    private safeParseJson;
    private clamp;
    private clampInt;
}
export {};

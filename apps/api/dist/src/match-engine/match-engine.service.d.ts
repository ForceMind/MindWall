import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';
interface RunMatchEngineBody {
    city?: string;
    max_matches_per_user?: number;
    min_score?: number;
    dry_run?: boolean;
}
export declare class MatchEngineService {
    private readonly prisma;
    private readonly adminConfigService;
    private readonly logger;
    constructor(prisma: PrismaService, adminConfigService: AdminConfigService);
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
    private safeParseJson;
    private clamp;
    private clampInt;
}
export {};

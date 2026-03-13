import type { SessionUser } from '../auth/auth.types';
import { MatchEngineService } from './match-engine.service';
interface RunMatchEngineBody {
    city?: string;
    max_matches_per_user?: number;
    min_score?: number;
    dry_run?: boolean;
}
export declare class MatchEngineController {
    private readonly matchEngineService;
    constructor(matchEngineService: MatchEngineService);
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
    getMyMatches(user: SessionUser): Promise<{
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
}
export {};

import { PrismaService } from '../prisma/prisma.service';
export declare class ContactsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getCandidateContacts(userId: string): Promise<{
        city_scope: null;
        candidates: {
            candidate_id: string;
            candidate_type: string;
            is_ai: boolean;
            disclosure: string;
            city: null;
            avatar: string;
            name: string;
            score: number;
            has_match: boolean;
            match_id: null;
            match_status: null;
            resonance_score: null;
            public_tags: {
                tag_name: string;
                weight: number;
                ai_justification: string;
            }[];
        }[];
    } | {
        city_scope: string;
        candidates: ({
            candidate_id: string;
            candidate_type: string;
            is_ai: boolean;
            disclosure: string;
            city: null;
            avatar: string;
            name: string;
            score: number;
            has_match: boolean;
            match_id: null;
            match_status: null;
            resonance_score: null;
            public_tags: {
                tag_name: string;
                weight: number;
                ai_justification: string;
            }[];
        } | {
            candidate_id: string;
            candidate_type: string;
            is_ai: boolean;
            disclosure: string;
            city: string;
            avatar: string | null;
            name: string;
            score: number;
            has_match: boolean;
            match_id: string | null;
            match_status: import("@prisma/client").$Enums.MatchStatus | null;
            resonance_score: number | null;
            public_tags: {
                tag_name: string;
                weight: number;
                ai_justification: string;
            }[];
        })[];
    }>;
    getConnectedContacts(userId: string): Promise<{
        total: number;
        contacts: {
            match_id: string;
            counterpart_user_id: string;
            candidate_type: string;
            is_ai: boolean;
            disclosure: string;
            name: string;
            avatar: string | null;
            city: string | null;
            status: import("@prisma/client").$Enums.MatchStatus;
            resonance_score: number;
            ai_match_reason: string | null;
            updated_at: Date;
            public_tags: {
                tag_name: string;
                weight: number;
                ai_justification: string;
            }[];
        }[];
    }>;
    connectToUser(userId: string, targetUserId: string): Promise<{
        existed: boolean;
        match_id: string;
        status: import("@prisma/client").$Enums.MatchStatus;
        resonance_score: number;
    }>;
    private computeCandidateScore;
    private buildAiCandidates;
    private buildPersonaAvatar;
}

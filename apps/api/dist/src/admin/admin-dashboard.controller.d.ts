import { UserStatus } from '@prisma/client';
import { AdminDashboardService } from './admin-dashboard.service';
export declare class AdminDashboardController {
    private readonly adminDashboardService;
    constructor(adminDashboardService: AdminDashboardService);
    overview(): Promise<{
        registered_users: number;
        active_sessions: number;
        online_users: number;
        user_status: Record<import("@prisma/client").$Enums.UserStatus, number>;
        ai_usage: {
            total_records: number;
            input_tokens: number;
            output_tokens: number;
            total_tokens: number;
            estimated_cost_usd: number;
        };
    }>;
    users(page?: string, limit?: string): Promise<{
        page: number;
        limit: number;
        total: number;
        users: {
            id: string;
            username: string | null;
            status: import("@prisma/client").$Enums.UserStatus;
            created_at: Date;
            online: boolean;
            profile: {
                anonymous_name: string | null;
                gender: string | null;
                age: number | null;
                city: string | null;
            } | null;
        }[];
    }>;
    userDetail(userId: string): Promise<{
        user: {
            id: string;
            auth_provider_id: string;
            username: string | null;
            status: import("@prisma/client").$Enums.UserStatus;
            created_at: Date;
        };
        profile: {
            updated_at: Date;
            real_avatar: string | null;
            real_name: string | null;
            anonymous_avatar: string | null;
            anonymous_name: string | null;
            gender: string | null;
            age: number | null;
            city: string | null;
            is_wall_broken: boolean;
        } | null;
        presence: {
            online: boolean;
            active_sessions: number;
            last_seen_at: Date;
        };
        stats: {
            total_matches: number;
            sent_messages: number;
            blocked_messages: number;
            modified_messages: number;
            passed_messages: number;
            ai_calls: number;
            input_tokens: number;
            output_tokens: number;
            total_tokens: number;
            estimated_cost_usd: number;
        };
        tags: {
            public: {
                created_at: Date;
                weight: number;
                tag_name: string;
                ai_justification: string;
            }[];
            hidden: {
                created_at: Date;
                weight: number;
                tag_name: string;
                ai_justification: string;
            }[];
        };
        recent: {
            sessions: {
                is_active: boolean;
                created_at: Date;
                id: string;
                revoked_at: Date | null;
                expires_at: Date;
                last_seen_at: Date;
            }[];
            ai_records: {
                estimated_cost_usd: number;
                created_at: Date;
                id: string;
                feature: string;
                prompt_key: string | null;
                provider: string;
                model: string;
                input_tokens: number;
                output_tokens: number;
                total_tokens: number;
            }[];
            matches: {
                counterpart: {
                    user_id: string;
                    username: string | null;
                    anonymous_name: string | null;
                    city: string | null;
                };
                created_at: Date;
                updated_at: Date;
                id: string;
                status: import("@prisma/client").$Enums.MatchStatus;
                user_a_id: string;
                user_b_id: string;
                resonance_score: number;
                ai_match_reason: string | null;
                wall_broken_at: Date | null;
            }[];
            messages: {
                id: string;
                match_id: string;
                ai_action: import("@prisma/client").$Enums.AiAction;
                original_text: string;
                ai_rewritten_text: string;
                created_at: Date;
                counterpart: {
                    user_id: string;
                    username: string | null;
                    anonymous_name: string | null;
                };
            }[];
            logs: {
                ts: string;
                level: string;
                event: string;
                message: string;
                metadata: Record<string, unknown> | null;
            }[];
        };
        timeline: {
            ts: string;
            type: string;
            title: string;
            detail: string;
            meta?: Record<string, unknown>;
        }[];
    }>;
    online(minutes?: string): Promise<{
        window_minutes: number;
        total_online: number;
        users: {
            user_id: string;
            username: string | null;
            status: import("@prisma/client").$Enums.UserStatus;
            last_seen_at: Date;
            profile: {
                anonymous_name: string | null;
                city: string | null;
            } | null;
        }[];
    }>;
    updateUserStatus(userId: string, status: UserStatus): Promise<{
        id: string;
        status: import("@prisma/client").$Enums.UserStatus;
    }>;
    aiRecords(page?: string, limit?: string): Promise<{
        page: number;
        limit: number;
        total: number;
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
            metadata: import("@prisma/client/runtime/client").JsonValue;
        }[];
    }>;
    prompts(): Promise<{
        updated_at: Date;
        id: string;
        name: string;
        key: string;
        category: string;
        content: string;
        version: number;
        is_active: boolean;
    }[]>;
    updatePrompt(key: string, body: {
        name?: string;
        category?: string;
        content?: string;
        is_active?: boolean;
    }): Promise<{
        created_at: Date;
        updated_at: Date;
        id: string;
        name: string;
        key: string;
        category: string;
        content: string;
        version: number;
        is_active: boolean;
    }>;
    logs(lines?: string): Promise<{
        file: string;
        available: boolean;
        total_lines: number;
        lines: string[];
    }>;
}

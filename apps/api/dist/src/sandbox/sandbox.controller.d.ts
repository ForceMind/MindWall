import type { SessionUser } from '../auth/auth.types';
import { SandboxService } from './sandbox.service';
export declare class SandboxController {
    private readonly sandboxService;
    constructor(sandboxService: SandboxService);
    getMyMatchMessages(user: SessionUser, matchId: string, limit?: string): Promise<{
        match_id: string;
        total: number;
        messages: {
            message_id: string;
            sender_id: string;
            original_text: string;
            ai_rewritten_text: string;
            ai_action: import("@prisma/client").$Enums.AiAction;
            hidden_tag_updates: import("@prisma/client/runtime/client").JsonValue;
            created_at: string;
        }[];
    }>;
    getMyWallState(user: SessionUser, matchId: string): Promise<import("./sandbox.service").WallDecisionResult>;
    submitMyWallDecision(user: SessionUser, matchId: string, body: {
        accept?: boolean;
    }): Promise<import("./sandbox.service").WallDecisionResult>;
}

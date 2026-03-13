import { AiAction, MatchStatus, Prisma } from '@prisma/client';
import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from '../telemetry/ai-usage.service';
import { PromptTemplateService } from '../telemetry/prompt-template.service';
import { ServerLogService } from '../telemetry/server-log.service';
interface ProcessMessageInput {
    matchId: string;
    senderId: string;
    text: string;
}
interface ProcessDirectMessageInput {
    matchId: string;
    senderId: string;
    text: string;
}
interface WallDecisionInput {
    matchId: string;
    userId: string;
    accept: boolean;
}
interface UserProfileBrief {
    userId: string;
    anonymousName: string | null;
    anonymousAvatar: string | null;
    realName: string | null;
    realAvatar: string | null;
}
export interface ProcessMessageResult {
    matchId: string;
    senderId: string;
    receiverId: string;
    messageId: string;
    originalText: string;
    rewrittenText: string;
    aiAction: AiAction;
    hiddenTagUpdates: Record<string, number>;
    reason: string;
    delivered: boolean;
    resonanceScore: number;
    wallReady: boolean;
    createdAt: string;
}
export interface DirectMessageResult {
    matchId: string;
    senderId: string;
    receiverId: string;
    messageId: string;
    text: string;
    createdAt: string;
}
export interface WallDecisionResult {
    matchId: string;
    status: MatchStatus;
    resonanceScore: number;
    wallReady: boolean;
    wallBroken: boolean;
    requesterAccepted: boolean;
    counterpartAccepted: boolean;
    consents: {
        userAId: string;
        userBId: string;
        userAAccepted: boolean;
        userBAccepted: boolean;
    };
    counterpartProfile: UserProfileBrief;
    selfProfile: UserProfileBrief;
}
export declare class SandboxService {
    private readonly prisma;
    private readonly adminConfigService;
    private readonly promptTemplateService;
    private readonly aiUsageService;
    private readonly serverLogService;
    private readonly logger;
    constructor(prisma: PrismaService, adminConfigService: AdminConfigService, promptTemplateService: PromptTemplateService, aiUsageService: AiUsageService, serverLogService: ServerLogService);
    ensureUserExists(userId: string): Promise<boolean>;
    assertMatchParticipant(matchId: string, userId: string): Promise<{
        match_id: string;
        status: import("@prisma/client").$Enums.MatchStatus;
        counterpart_user_id: string;
        resonance_score: number;
        wall_ready: boolean;
        wall_broken: boolean;
    }>;
    getMatchMessages(matchId: string, userId: string | null, limit: number): Promise<{
        match_id: string;
        total: number;
        messages: {
            message_id: string;
            sender_id: string;
            original_text: string;
            ai_rewritten_text: string;
            ai_action: import("@prisma/client").$Enums.AiAction;
            hidden_tag_updates: Prisma.JsonValue;
            created_at: string;
        }[];
    }>;
    getWallState(matchId: string, userId: string): Promise<WallDecisionResult>;
    submitWallDecision(input: WallDecisionInput): Promise<WallDecisionResult>;
    processMessage(input: ProcessMessageInput): Promise<ProcessMessageResult>;
    processDirectMessage(input: ProcessDirectMessageInput): Promise<DirectMessageResult>;
    private buildWallStateFromInfo;
    private getProfilePair;
    private getMatchParticipantInfo;
    private parseConsentMap;
    private runMiddleware;
    private normalizeMiddlewareDecision;
    private fallbackMiddleware;
    private softenTone;
    private normalizeHiddenTagUpdateMap;
    private applyHiddenTagUpdates;
    private callOpenAiJson;
    private safeParseJson;
}
export {};

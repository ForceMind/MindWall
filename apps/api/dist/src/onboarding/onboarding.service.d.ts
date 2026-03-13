import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';
interface StartSessionBody {
    auth_provider_id?: string;
    city?: string;
}
interface SendMessageBody {
    message?: string;
}
export declare class OnboardingService {
    private readonly prisma;
    private readonly adminConfigService;
    private readonly logger;
    private readonly sessions;
    private readonly totalQuestions;
    private readonly fallbackQuestions;
    constructor(prisma: PrismaService, adminConfigService: AdminConfigService);
    startSession(body: StartSessionBody): Promise<{
        status: string;
        session_id: `${string}-${string}-${string}-${string}-${string}`;
        user_id: string;
        city: string | null;
        assistant_message: string;
        remaining_questions: number;
    }>;
    startSessionForUser(userId: string, body: Omit<StartSessionBody, 'auth_provider_id'>): Promise<{
        status: string;
        session_id: `${string}-${string}-${string}-${string}-${string}`;
        user_id: string;
        city: string | null;
        assistant_message: string;
        remaining_questions: number;
    }>;
    submitMessageForUser(sessionId: string, body: SendMessageBody, userId: string): Promise<{
        status: string;
        session_id: string;
        assistant_message: string;
        remaining_questions: number;
        user_id?: undefined;
        public_tags?: undefined;
        onboarding_summary?: undefined;
    } | {
        status: string;
        user_id: string;
        public_tags: {
            weight: number;
            tag_name: string;
            ai_justification: string;
        }[];
        onboarding_summary: string;
        session_id?: undefined;
        assistant_message?: undefined;
        remaining_questions?: undefined;
    }>;
    submitMessage(sessionId: string, body: SendMessageBody): Promise<{
        status: string;
        session_id: string;
        assistant_message: string;
        remaining_questions: number;
        user_id?: undefined;
        public_tags?: undefined;
        onboarding_summary?: undefined;
    } | {
        status: string;
        user_id: string;
        public_tags: {
            weight: number;
            tag_name: string;
            ai_justification: string;
        }[];
        onboarding_summary: string;
        session_id?: undefined;
        assistant_message?: undefined;
        remaining_questions?: undefined;
    }>;
    private initializeSession;
    private submitMessageInternal;
    private generateQuestion;
    private extractTags;
    private persistTags;
    private normalizeExtraction;
    private normalizeTag;
    private fallbackTagExtraction;
    private renderTranscript;
    private attachEmbedding;
    private buildTagEmbedding;
    private buildDeterministicEmbedding;
    private normalizeVector;
    private hashSeed;
    private callOpenAiJson;
    private safeParseJson;
}
export {};

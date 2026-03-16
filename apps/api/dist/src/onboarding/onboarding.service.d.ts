import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from '../telemetry/ai-usage.service';
import { PromptTemplateService } from '../telemetry/prompt-template.service';
import { ServerLogService } from '../telemetry/server-log.service';
interface StartSessionBody {
    auth_provider_id?: string;
    city?: string;
}
interface SendMessageBody {
    message?: string;
}
interface SaveBasicsBody {
    gender?: string;
    age?: number;
}
interface SaveCityBody {
    city?: string;
}
export declare class OnboardingService {
    private readonly prisma;
    private readonly adminConfigService;
    private readonly promptTemplateService;
    private readonly aiUsageService;
    private readonly serverLogService;
    private readonly logger;
    private readonly sessions;
    private readonly totalQuestions;
    private readonly anonymousPrefix;
    private readonly anonymousSuffix;
    private readonly fallbackQuestions;
    private readonly interviewFocuses;
    constructor(prisma: PrismaService, adminConfigService: AdminConfigService, promptTemplateService: PromptTemplateService, aiUsageService: AiUsageService, serverLogService: ServerLogService);
    saveBasicsForUser(userId: string, body: SaveBasicsBody): Promise<{
        status: string;
        message: string;
        profile: {
            anonymous_avatar: string | null;
            anonymous_name: string | null;
            gender: string | null;
            age: number | null;
            city: string | null;
        };
    }>;
    saveCityForUser(userId: string, body: SaveCityBody): Promise<{
        status: string;
        message: string;
        profile: {
            anonymous_avatar: string | null;
            anonymous_name: string | null;
            gender: string | null;
            age: number | null;
            city: string | null;
        };
    }>;
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
    private appendTurn;
    private generateQuestion;
    private extractTags;
    private persistTags;
    private normalizeExtraction;
    private normalizeTag;
    private refreshAnonymousIdentity;
    private fallbackTagExtraction;
    private renderTranscript;
    private getPreviousAssistantQuestions;
    private getLatestUserAnswer;
    private pickFallbackQuestion;
    private getInterviewFocus;
    private buildAdaptiveFallbackQuestion;
    private pickAnswerAnchor;
    private isRepeatedQuestion;
    private isClosedEndedQuestion;
    private normalizeQuestionText;
    private normalizeGender;
    private normalizeAge;
    private normalizeCity;
    private buildAnonymousIdentity;
    private buildAvatarDataUri;
    private attachEmbedding;
    private buildTagEmbedding;
    private buildDeterministicEmbedding;
    private normalizeVector;
    private hashSeed;
    private callOpenAiJson;
    private safeParseJson;
}
export {};

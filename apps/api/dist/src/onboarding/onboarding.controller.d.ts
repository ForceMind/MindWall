import type { SessionUser } from '../auth/auth.types';
import { OnboardingService } from './onboarding.service';
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
export declare class OnboardingController {
    private readonly onboardingService;
    constructor(onboardingService: OnboardingService);
    startSession(body: StartSessionBody): Promise<{
        status: string;
        session_id: `${string}-${string}-${string}-${string}-${string}`;
        user_id: string;
        city: string | null;
        assistant_message: string;
        remaining_questions: number;
    }>;
    startMySession(user: SessionUser, body: Omit<StartSessionBody, 'auth_provider_id'>): Promise<{
        status: string;
        session_id: `${string}-${string}-${string}-${string}-${string}`;
        user_id: string;
        city: string | null;
        assistant_message: string;
        remaining_questions: number;
    }>;
    saveMyProfile(user: SessionUser, body: SaveBasicsBody): Promise<{
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
    saveMyCity(user: SessionUser, body: SaveCityBody): Promise<{
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
    sendMessage(sessionId: string, body: SendMessageBody): Promise<{
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
    sendMyMessage(user: SessionUser, sessionId: string, body: SendMessageBody): Promise<{
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
}
export {};

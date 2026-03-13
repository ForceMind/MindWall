import { PrismaService } from '../prisma/prisma.service';
import type { SessionUser } from './auth.types';
interface RegisterBody {
    email?: string;
    password?: string;
    display_name?: string;
}
interface LoginBody {
    email?: string;
    password?: string;
}
export declare class AuthService {
    private readonly prisma;
    private readonly sessionTtlMs;
    constructor(prisma: PrismaService);
    register(body: RegisterBody): Promise<{
        user: {
            id: string;
            email: string;
            status: import("@prisma/client").$Enums.UserStatus;
            created_at: Date;
        };
        profile: {
            real_avatar: string | null;
            real_name: string | null;
            city: string | null;
            is_wall_broken: boolean;
        } | null;
        public_tags: {
            weight: number;
            tag_name: string;
            ai_justification: string;
        }[];
        session_token: string;
        expires_at: string;
    }>;
    login(body: LoginBody): Promise<{
        user: {
            id: string;
            email: string;
            status: import("@prisma/client").$Enums.UserStatus;
            created_at: Date;
        };
        profile: {
            real_avatar: string | null;
            real_name: string | null;
            city: string | null;
            is_wall_broken: boolean;
        } | null;
        public_tags: {
            weight: number;
            tag_name: string;
            ai_justification: string;
        }[];
        session_token: string;
        expires_at: string;
    }>;
    getMe(userId: string): Promise<{
        user: {
            id: string;
            email: string;
            status: import("@prisma/client").$Enums.UserStatus;
            created_at: Date;
        };
        profile: {
            real_avatar: string | null;
            real_name: string | null;
            city: string | null;
            is_wall_broken: boolean;
        } | null;
        public_tags: {
            weight: number;
            tag_name: string;
            ai_justification: string;
        }[];
    }>;
    logout(sessionId: string): Promise<{
        status: string;
    }>;
    authenticateFromAuthorizationHeader(authorization?: string): Promise<SessionUser | null>;
    private createSession;
    private hashPassword;
    private verifyPassword;
    private hashToken;
    private extractBearerToken;
    private normalizeEmail;
    private normalizePassword;
    private normalizeDisplayName;
    private rethrowAuthInfraError;
}
export {};

import { AuthService } from './auth.service';
import type { SessionUser } from './auth.types';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(body: {
        email?: string;
        password?: string;
        display_name?: string;
    }): Promise<{
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
    login(body: {
        email?: string;
        password?: string;
    }): Promise<{
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
    me(user: SessionUser): Promise<{
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
    logout(user: SessionUser): Promise<{
        status: string;
    }>;
}

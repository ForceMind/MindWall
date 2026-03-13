import { AuthService } from './auth.service';
import type { SessionUser } from './auth.types';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(body: {
        username?: string;
        password?: string;
    }): Promise<{
        user: {
            id: string;
            username: string;
            status: import("@prisma/client").$Enums.UserStatus;
            created_at: Date;
        };
        profile: {
            real_avatar: string | null;
            real_name: string | null;
            anonymous_avatar: string | null;
            anonymous_name: string | null;
            gender: string | null;
            age: number | null;
            city: string | null;
            is_wall_broken: boolean;
        } | null;
        public_tags: {
            tag_name: string;
            weight: number;
            ai_justification: string;
        }[];
        session_token: string;
        expires_at: string;
    }>;
    login(body: {
        username?: string;
        password?: string;
    }): Promise<{
        user: {
            id: string;
            username: string;
            status: import("@prisma/client").$Enums.UserStatus;
            created_at: Date;
        };
        profile: {
            real_avatar: string | null;
            real_name: string | null;
            anonymous_avatar: string | null;
            anonymous_name: string | null;
            gender: string | null;
            age: number | null;
            city: string | null;
            is_wall_broken: boolean;
        } | null;
        public_tags: {
            tag_name: string;
            weight: number;
            ai_justification: string;
        }[];
        session_token: string;
        expires_at: string;
    }>;
    me(user: SessionUser): Promise<{
        user: {
            id: string;
            username: string;
            status: import("@prisma/client").$Enums.UserStatus;
            created_at: Date;
        };
        profile: {
            real_avatar: string | null;
            real_name: string | null;
            anonymous_avatar: string | null;
            anonymous_name: string | null;
            gender: string | null;
            age: number | null;
            city: string | null;
            is_wall_broken: boolean;
        } | null;
        public_tags: {
            tag_name: string;
            weight: number;
            ai_justification: string;
        }[];
    }>;
    logout(user: SessionUser): Promise<{
        status: string;
    }>;
}

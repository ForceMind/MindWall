import { AdminAuthService } from './admin-auth.service';
export declare class AdminAuthController {
    private readonly adminAuthService;
    constructor(adminAuthService: AdminAuthService);
    login(body: {
        username?: string;
        password?: string;
    }): Promise<{
        session_token: string;
        username: string;
        expires_at: string;
    }>;
    session(authorization?: string, adminTokenHeader?: string): Promise<{
        username: string;
        expires_at: string | null;
        auth_mode: string;
    }>;
    logout(authorization?: string): Promise<{
        status: string;
    }>;
}

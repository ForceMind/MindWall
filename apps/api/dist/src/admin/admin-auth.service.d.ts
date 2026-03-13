import { ServerLogService } from '../telemetry/server-log.service';
export declare class AdminAuthService {
    private readonly serverLogService;
    private readonly sessions;
    private readonly sessionTtlMs;
    constructor(serverLogService: ServerLogService);
    login(body: {
        username?: string;
        password?: string;
    }): Promise<{
        session_token: string;
        username: string;
        expires_at: string;
    }>;
    authenticateAdminRequest(input: {
        authorization?: string;
        adminTokenHeader?: string;
    }): Promise<{
        username: string;
        expires_at: string | null;
        auth_mode: string;
    }>;
    getCurrentSession(input: {
        authorization?: string;
        adminTokenHeader?: string;
    }): Promise<{
        username: string;
        expires_at: string | null;
        auth_mode: string;
    }>;
    logout(authorization?: string): Promise<{
        status: string;
    }>;
    private getConfiguredCredentials;
    private assertCredentialsConfigured;
    private getHeaderTokenIdentity;
    private getBearerSession;
    private extractBearerToken;
    private hashToken;
    private safeEquals;
}

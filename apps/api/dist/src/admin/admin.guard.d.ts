import { CanActivate, ExecutionContext } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
export declare class AdminGuard implements CanActivate {
    private readonly adminAuthService;
    constructor(adminAuthService: AdminAuthService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}

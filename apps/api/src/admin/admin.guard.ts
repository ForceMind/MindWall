import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;
    const tokenHeader = request.headers['x-admin-token'];

    request.adminAuth = await this.adminAuthService.authenticateAdminRequest({
      authorization: Array.isArray(authorization) ? authorization[0] : authorization,
      adminTokenHeader: Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader,
    });

    return true;
  }
}

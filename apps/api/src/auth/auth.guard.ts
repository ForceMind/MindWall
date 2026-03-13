import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;
    const authUser = await this.authService.authenticateFromAuthorizationHeader(
      Array.isArray(authorization) ? authorization[0] : authorization,
    );

    if (!authUser) {
      throw new UnauthorizedException('Authentication required.');
    }

    request.authUser = authUser;
    return true;
  }
}

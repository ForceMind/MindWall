import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tokenHeader = request.headers['x-admin-token'];
    const provided = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    const expected = process.env.ADMIN_TOKEN || '';

    if (!expected) {
      throw new UnauthorizedException(
        'ADMIN_TOKEN is not configured on server.',
      );
    }

    if (!provided || String(provided).trim() !== expected) {
      throw new UnauthorizedException('Invalid admin token.');
    }

    return true;
  }
}

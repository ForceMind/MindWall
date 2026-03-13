import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ServerLogService } from '../telemetry/server-log.service';

interface AdminSessionRecord {
  username: string;
  expiresAt: number;
}

@Injectable()
export class AdminAuthService {
  private readonly sessions = new Map<string, AdminSessionRecord>();
  private readonly sessionTtlMs = 1000 * 60 * 60 * 12;

  constructor(private readonly serverLogService: ServerLogService) {}

  async login(body: { username?: string; password?: string }) {
    const credentials = this.getConfiguredCredentials();
    const username = body.username?.trim() || '';
    const password = body.password?.trim() || '';

    if (
      !this.safeEquals(username, credentials.username) ||
      !this.safeEquals(password, credentials.password)
    ) {
      await this.serverLogService.warn('admin.auth.login_failed', 'invalid admin credentials', {
        username,
      });
      throw new UnauthorizedException('Invalid admin username or password.');
    }

    const token = `mwa_${randomBytes(32).toString('hex')}`;
    const expiresAt = Date.now() + this.sessionTtlMs;
    this.sessions.set(this.hashToken(token), {
      username: credentials.username,
      expiresAt,
    });
    await this.serverLogService.info('admin.auth.login', 'admin login success', {
      username: credentials.username,
    });

    return {
      session_token: token,
      username: credentials.username,
      expires_at: new Date(expiresAt).toISOString(),
    };
  }

  async authenticateAdminRequest(input: {
    authorization?: string;
    adminTokenHeader?: string;
  }) {
    const bearerToken = this.extractBearerToken(input.authorization);
    if (bearerToken) {
      const bearerSession = this.getBearerSession(bearerToken);
      if (bearerSession) {
        return bearerSession;
      }
    }

    const headerToken = input.adminTokenHeader?.trim() || '';
    if (headerToken) {
      const tokenIdentity = this.getHeaderTokenIdentity(headerToken);
      if (tokenIdentity) {
        return tokenIdentity;
      }
    }

    this.assertCredentialsConfigured();
    throw new UnauthorizedException('Admin login required.');
  }

  async getCurrentSession(input: {
    authorization?: string;
    adminTokenHeader?: string;
  }) {
    return this.authenticateAdminRequest(input);
  }

  async logout(authorization?: string) {
    const token = this.extractBearerToken(authorization);
    if (!token) {
      return { status: 'ok' };
    }

    this.sessions.delete(this.hashToken(token));
    await this.serverLogService.info('admin.auth.logout', 'admin logout');
    return { status: 'ok' };
  }

  private getConfiguredCredentials() {
    const username = process.env.ADMIN_USERNAME?.trim() || 'admin';
    const password =
      process.env.ADMIN_PASSWORD?.trim() || process.env.ADMIN_TOKEN?.trim() || '';

    if (!password) {
      throw new UnauthorizedException(
        'Admin credentials are not configured on server.',
      );
    }

    return {
      username,
      password,
    };
  }

  private assertCredentialsConfigured() {
    this.getConfiguredCredentials();
  }

  private getHeaderTokenIdentity(token: string) {
    const credentials = this.getConfiguredCredentials();
    if (!this.safeEquals(token, credentials.password)) {
      return null;
    }

    return {
      username: credentials.username,
      expires_at: null as string | null,
      auth_mode: 'token',
    };
  }

  private getBearerSession(token: string) {
    const tokenHash = this.hashToken(token);
    const session = this.sessions.get(tokenHash);
    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }

    return {
      username: session.username,
      expires_at: new Date(session.expiresAt).toISOString(),
      auth_mode: 'session',
    };
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization) {
      return '';
    }

    const [scheme, token] = authorization.trim().split(/\s+/, 2);
    if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
      return '';
    }

    return token;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeEquals(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }
}

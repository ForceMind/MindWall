import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'crypto';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionUser } from './auth.types';

const scryptAsync = promisify(scrypt);

interface RegisterBody {
  email?: string;
  password?: string;
  display_name?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

@Injectable()
export class AuthService {
  private readonly sessionTtlMs = 1000 * 60 * 60 * 24 * 30;

  constructor(private readonly prisma: PrismaService) {}

  async register(body: RegisterBody) {
    try {
      const email = this.normalizeEmail(body.email);
      const password = this.normalizePassword(body.password);
      const displayName = this.normalizeDisplayName(body.display_name);

      const existing = await this.prisma.userCredential.findUnique({
        where: { email },
        select: { user_id: true },
      });
      if (existing) {
        throw new ConflictException('Email is already registered.');
      }

      const passwordHash = await this.hashPassword(password);
      const created = await this.prisma.user.create({
        data: {
          auth_provider_id: `local:${email}`,
          status: UserStatus.onboarding,
          profile: {
            create: {
              real_name: displayName || undefined,
            },
          },
          credential: {
            create: {
              email,
              password_hash: passwordHash,
            },
          },
        },
        select: {
          id: true,
        },
      });

      const session = await this.createSession(created.id);
      const me = await this.getMe(created.id);

      return {
        session_token: session.token,
        expires_at: session.expiresAt,
        ...me,
      };
    } catch (error) {
      this.rethrowAuthInfraError(error);
    }
  }

  async login(body: LoginBody) {
    try {
      const email = this.normalizeEmail(body.email);
      const password = this.normalizePassword(body.password);

      const credential = await this.prisma.userCredential.findUnique({
        where: { email },
        select: {
          user_id: true,
          password_hash: true,
        },
      });
      if (!credential) {
        throw new UnauthorizedException('Invalid email or password.');
      }

      const valid = await this.verifyPassword(password, credential.password_hash);
      if (!valid) {
        throw new UnauthorizedException('Invalid email or password.');
      }

      const session = await this.createSession(credential.user_id);
      const me = await this.getMe(credential.user_id);

      return {
        session_token: session.token,
        expires_at: session.expiresAt,
        ...me,
      };
    } catch (error) {
      this.rethrowAuthInfraError(error);
    }
  }

  async getMe(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          status: true,
          created_at: true,
          credential: {
            select: {
              email: true,
            },
          },
          profile: {
            select: {
              real_name: true,
              real_avatar: true,
              city: true,
              is_wall_broken: true,
            },
          },
          tags: {
            where: {
              type: 'PUBLIC_VISIBLE',
            },
            orderBy: {
              weight: 'desc',
            },
            take: 8,
            select: {
              tag_name: true,
              weight: true,
              ai_justification: true,
            },
          },
        },
      });

      if (!user || !user.credential) {
        throw new UnauthorizedException('User session is invalid.');
      }

      return {
        user: {
          id: user.id,
          email: user.credential.email,
          status: user.status,
          created_at: user.created_at,
        },
        profile: user.profile,
        public_tags: user.tags,
      };
    } catch (error) {
      this.rethrowAuthInfraError(error);
    }
  }

  async logout(sessionId: string) {
    try {
      await this.prisma.authSession.updateMany({
        where: {
          id: sessionId,
          revoked_at: null,
        },
        data: {
          revoked_at: new Date(),
        },
      });

      return {
        status: 'ok',
      };
    } catch (error) {
      this.rethrowAuthInfraError(error);
    }
  }

  async authenticateFromAuthorizationHeader(
    authorization?: string,
  ): Promise<SessionUser | null> {
    try {
      const token = this.extractBearerToken(authorization);
      if (!token) {
        return null;
      }

      const tokenHash = this.hashToken(token);
      const session = await this.prisma.authSession.findUnique({
        where: { token_hash: tokenHash },
        select: {
          id: true,
          user_id: true,
          expires_at: true,
          revoked_at: true,
          user: {
            select: {
              status: true,
              credential: {
                select: {
                  email: true,
                },
              },
            },
          },
        },
      });

      if (
        !session ||
        session.revoked_at ||
        session.expires_at.getTime() <= Date.now() ||
        !session.user.credential
      ) {
        return null;
      }

      return {
        sessionId: session.id,
        userId: session.user_id,
        email: session.user.credential.email,
        status: session.user.status,
      };
    } catch (error) {
      this.rethrowAuthInfraError(error);
    }
  }

  private async createSession(userId: string) {
    const token = `mw_${randomBytes(32).toString('hex')}`;
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);

    await this.prisma.authSession.create({
      data: {
        user_id: userId,
        token_hash: this.hashToken(token),
        expires_at: expiresAt,
      },
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derived = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt}:${derived.toString('hex')}`;
  }

  private async verifyPassword(password: string, stored: string) {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) {
      return false;
    }

    const derived = (await scryptAsync(password, salt, 64)) as Buffer;
    const storedBuffer = Buffer.from(hash, 'hex');
    if (storedBuffer.length !== derived.length) {
      return false;
    }

    return timingSafeEqual(storedBuffer, derived);
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization) {
      return null;
    }
    const [scheme, token] = authorization.trim().split(/\s+/, 2);
    if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
      return null;
    }
    return token;
  }

  private normalizeEmail(email?: string) {
    const normalized = email?.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('email is required.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BadRequestException('email format is invalid.');
    }
    return normalized;
  }

  private normalizePassword(password?: string) {
    const normalized = password?.trim();
    if (!normalized) {
      throw new BadRequestException('password is required.');
    }
    if (normalized.length < 8) {
      throw new BadRequestException('password must be at least 8 characters.');
    }
    return normalized;
  }

  private normalizeDisplayName(displayName?: string) {
    const normalized = displayName?.trim() || '';
    if (!normalized) {
      return '';
    }
    return normalized.slice(0, 48);
  }

  private rethrowAuthInfraError(error: unknown): never {
    if (error instanceof HttpException) {
      throw error;
    }

    const prismaCode =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    const message = error instanceof Error ? error.message : String(error);
    if (
      prismaCode === 'ECONNREFUSED' ||
      /ECONNREFUSED|Can't reach database server|connect ECONNREFUSED|connection terminated|database/i.test(
        message,
      )
    ) {
      throw new ServiceUnavailableException(
        'Database is unavailable. Start PostgreSQL and retry.',
      );
    }

    throw error;
  }
}

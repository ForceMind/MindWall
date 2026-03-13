"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const util_1 = require("util");
const prisma_service_1 = require("../prisma/prisma.service");
const server_log_service_1 = require("../telemetry/server-log.service");
const scryptAsync = (0, util_1.promisify)(crypto_1.scrypt);
let AuthService = class AuthService {
    prisma;
    serverLogService;
    sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
    constructor(prisma, serverLogService) {
        this.prisma = prisma;
        this.serverLogService = serverLogService;
    }
    async register(body) {
        try {
            const username = this.normalizeUsername(body.username);
            const password = this.normalizePassword(body.password);
            const existing = await this.prisma.userCredential.findUnique({
                where: { username },
                select: { user_id: true },
            });
            if (existing) {
                throw new common_1.ConflictException('Username is already registered.');
            }
            const passwordHash = await this.hashPassword(password);
            const created = await this.prisma.user.create({
                data: {
                    auth_provider_id: `local:${username}`,
                    status: client_1.UserStatus.onboarding,
                    profile: {
                        create: {},
                    },
                    credential: {
                        create: {
                            username,
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
            await this.serverLogService.info('auth.register', 'user registered', {
                user_id: created.id,
                username,
            });
            return {
                session_token: session.token,
                expires_at: session.expiresAt,
                ...me,
            };
        }
        catch (error) {
            this.rethrowAuthInfraError(error);
        }
    }
    async login(body) {
        try {
            const username = this.normalizeUsername(body.username);
            const password = this.normalizePassword(body.password);
            const credential = await this.prisma.userCredential.findUnique({
                where: { username },
                select: {
                    user_id: true,
                    password_hash: true,
                },
            });
            if (!credential) {
                throw new common_1.UnauthorizedException('Invalid username or password.');
            }
            const valid = await this.verifyPassword(password, credential.password_hash);
            if (!valid) {
                throw new common_1.UnauthorizedException('Invalid username or password.');
            }
            const session = await this.createSession(credential.user_id);
            const me = await this.getMe(credential.user_id);
            await this.serverLogService.info('auth.login', 'user login success', {
                user_id: credential.user_id,
                username,
            });
            return {
                session_token: session.token,
                expires_at: session.expiresAt,
                ...me,
            };
        }
        catch (error) {
            this.rethrowAuthInfraError(error);
        }
    }
    async getMe(userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    status: true,
                    created_at: true,
                    credential: {
                        select: {
                            username: true,
                        },
                    },
                    profile: {
                        select: {
                            real_name: true,
                            real_avatar: true,
                            anonymous_name: true,
                            anonymous_avatar: true,
                            gender: true,
                            age: true,
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
                throw new common_1.UnauthorizedException('User session is invalid.');
            }
            return {
                user: {
                    id: user.id,
                    username: user.credential.username,
                    status: user.status,
                    created_at: user.created_at,
                },
                profile: user.profile,
                public_tags: user.tags,
            };
        }
        catch (error) {
            this.rethrowAuthInfraError(error);
        }
    }
    async logout(sessionId) {
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
            await this.serverLogService.info('auth.logout', 'user logout', {
                session_id: sessionId,
            });
            return {
                status: 'ok',
            };
        }
        catch (error) {
            this.rethrowAuthInfraError(error);
        }
    }
    async authenticateFromAuthorizationHeader(authorization) {
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
                                    username: true,
                                },
                            },
                        },
                    },
                },
            });
            if (!session ||
                session.revoked_at ||
                session.expires_at.getTime() <= Date.now() ||
                !session.user.credential) {
                return null;
            }
            await this.prisma.authSession.update({
                where: { id: session.id },
                data: {
                    last_seen_at: new Date(),
                },
            });
            return {
                sessionId: session.id,
                userId: session.user_id,
                username: session.user.credential.username,
                status: session.user.status,
            };
        }
        catch (error) {
            this.rethrowAuthInfraError(error);
        }
    }
    async createSession(userId) {
        const token = `mw_${(0, crypto_1.randomBytes)(32).toString('hex')}`;
        const expiresAt = new Date(Date.now() + this.sessionTtlMs);
        await this.prisma.authSession.create({
            data: {
                user_id: userId,
                token_hash: this.hashToken(token),
                expires_at: expiresAt,
                last_seen_at: new Date(),
            },
        });
        return {
            token,
            expiresAt: expiresAt.toISOString(),
        };
    }
    async hashPassword(password) {
        const salt = (0, crypto_1.randomBytes)(16).toString('hex');
        const derived = (await scryptAsync(password, salt, 64));
        return `${salt}:${derived.toString('hex')}`;
    }
    async verifyPassword(password, stored) {
        const [salt, hash] = stored.split(':');
        if (!salt || !hash) {
            return false;
        }
        const derived = (await scryptAsync(password, salt, 64));
        const storedBuffer = Buffer.from(hash, 'hex');
        if (storedBuffer.length !== derived.length) {
            return false;
        }
        return (0, crypto_1.timingSafeEqual)(storedBuffer, derived);
    }
    hashToken(token) {
        return (0, crypto_1.createHash)('sha256').update(token).digest('hex');
    }
    extractBearerToken(authorization) {
        if (!authorization) {
            return null;
        }
        const [scheme, token] = authorization.trim().split(/\s+/, 2);
        if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
            return null;
        }
        return token;
    }
    normalizeUsername(username) {
        const normalized = (username || '').trim().normalize('NFKC').toLowerCase();
        if (!normalized) {
            throw new common_1.BadRequestException('username is required.');
        }
        if (normalized.length < 2 || normalized.length > 24) {
            throw new common_1.BadRequestException('username must be between 2 and 24 characters.');
        }
        if (!/^[\p{L}\p{N}_-]+$/u.test(normalized)) {
            throw new common_1.BadRequestException('username can only contain letters, numbers, underscore, and hyphen.');
        }
        return normalized;
    }
    normalizePassword(password) {
        const normalized = password?.trim();
        if (!normalized) {
            throw new common_1.BadRequestException('password is required.');
        }
        if (normalized.length < 6) {
            throw new common_1.BadRequestException('password must be at least 6 characters.');
        }
        return normalized;
    }
    rethrowAuthInfraError(error) {
        if (error instanceof common_1.HttpException) {
            throw error;
        }
        const prismaCode = error && typeof error === 'object' && 'code' in error
            ? String(error.code || '')
            : '';
        const message = error instanceof Error ? error.message : String(error);
        if (prismaCode === 'ECONNREFUSED' ||
            /ECONNREFUSED|Can't reach database server|connect ECONNREFUSED|connection terminated|database/i.test(message)) {
            throw new common_1.ServiceUnavailableException('Database is unavailable. Start PostgreSQL and retry.');
        }
        throw error;
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        server_log_service_1.ServerLogService])
], AuthService);
//# sourceMappingURL=auth.service.js.map
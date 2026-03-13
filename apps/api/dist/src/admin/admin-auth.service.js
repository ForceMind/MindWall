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
exports.AdminAuthService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const server_log_service_1 = require("../telemetry/server-log.service");
let AdminAuthService = class AdminAuthService {
    serverLogService;
    sessions = new Map();
    sessionTtlMs = 1000 * 60 * 60 * 12;
    constructor(serverLogService) {
        this.serverLogService = serverLogService;
    }
    async login(body) {
        const credentials = this.getConfiguredCredentials();
        const username = body.username?.trim() || '';
        const password = body.password?.trim() || '';
        if (!this.safeEquals(username, credentials.username) ||
            !this.safeEquals(password, credentials.password)) {
            await this.serverLogService.warn('admin.auth.login_failed', 'invalid admin credentials', {
                username,
            });
            throw new common_1.UnauthorizedException('Invalid admin username or password.');
        }
        const token = `mwa_${(0, crypto_1.randomBytes)(32).toString('hex')}`;
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
    async authenticateAdminRequest(input) {
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
        throw new common_1.UnauthorizedException('Admin login required.');
    }
    async getCurrentSession(input) {
        return this.authenticateAdminRequest(input);
    }
    async logout(authorization) {
        const token = this.extractBearerToken(authorization);
        if (!token) {
            return { status: 'ok' };
        }
        this.sessions.delete(this.hashToken(token));
        await this.serverLogService.info('admin.auth.logout', 'admin logout');
        return { status: 'ok' };
    }
    getConfiguredCredentials() {
        const username = process.env.ADMIN_USERNAME?.trim() || 'admin';
        const password = process.env.ADMIN_PASSWORD?.trim() || process.env.ADMIN_TOKEN?.trim() || '';
        if (!password) {
            throw new common_1.UnauthorizedException('Admin credentials are not configured on server.');
        }
        return {
            username,
            password,
        };
    }
    assertCredentialsConfigured() {
        this.getConfiguredCredentials();
    }
    getHeaderTokenIdentity(token) {
        const credentials = this.getConfiguredCredentials();
        if (!this.safeEquals(token, credentials.password)) {
            return null;
        }
        return {
            username: credentials.username,
            expires_at: null,
            auth_mode: 'token',
        };
    }
    getBearerSession(token) {
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
    extractBearerToken(authorization) {
        if (!authorization) {
            return '';
        }
        const [scheme, token] = authorization.trim().split(/\s+/, 2);
        if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
            return '';
        }
        return token;
    }
    hashToken(token) {
        return (0, crypto_1.createHash)('sha256').update(token).digest('hex');
    }
    safeEquals(left, right) {
        const leftBuffer = Buffer.from(left);
        const rightBuffer = Buffer.from(right);
        if (leftBuffer.length !== rightBuffer.length) {
            return false;
        }
        return (0, crypto_1.timingSafeEqual)(leftBuffer, rightBuffer);
    }
};
exports.AdminAuthService = AdminAuthService;
exports.AdminAuthService = AdminAuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_log_service_1.ServerLogService])
], AdminAuthService);
//# sourceMappingURL=admin-auth.service.js.map
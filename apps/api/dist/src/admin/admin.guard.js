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
exports.AdminGuard = void 0;
const common_1 = require("@nestjs/common");
const admin_auth_service_1 = require("./admin-auth.service");
let AdminGuard = class AdminGuard {
    adminAuthService;
    constructor(adminAuthService) {
        this.adminAuthService = adminAuthService;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const authorization = request.headers.authorization;
        const tokenHeader = request.headers['x-admin-token'];
        request.adminAuth = await this.adminAuthService.authenticateAdminRequest({
            authorization: Array.isArray(authorization) ? authorization[0] : authorization,
            adminTokenHeader: Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader,
        });
        return true;
    }
};
exports.AdminGuard = AdminGuard;
exports.AdminGuard = AdminGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [admin_auth_service_1.AdminAuthService])
], AdminGuard);
//# sourceMappingURL=admin.guard.js.map
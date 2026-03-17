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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const sandbox_service_1 = require("./sandbox.service");
let SandboxController = class SandboxController {
    sandboxService;
    constructor(sandboxService) {
        this.sandboxService = sandboxService;
    }
    async getMyMatchMessages(user, matchId, limit) {
        const parsedLimit = Number(limit);
        const normalizedLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
            ? Math.round(parsedLimit)
            : 50;
        return this.sandboxService.getMatchMessages(matchId, user.userId, normalizedLimit);
    }
    async getMyWallState(user, matchId) {
        return this.sandboxService.getWallState(matchId, user.userId);
    }
    async submitMyWallDecision(user, matchId, body) {
        return this.sandboxService.submitWallDecision({
            matchId,
            userId: user.userId,
            accept: body.accept === true,
        });
    }
};
exports.SandboxController = SandboxController;
__decorate([
    (0, common_1.Get)('me/matches/:matchId/messages'),
    (0, common_1.UseGuards)(auth_guard_1.SessionAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('matchId')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], SandboxController.prototype, "getMyMatchMessages", null);
__decorate([
    (0, common_1.Get)('me/matches/:matchId/wall-state'),
    (0, common_1.UseGuards)(auth_guard_1.SessionAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('matchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SandboxController.prototype, "getMyWallState", null);
__decorate([
    (0, common_1.Post)('me/matches/:matchId/wall-decision'),
    (0, common_1.UseGuards)(auth_guard_1.SessionAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('matchId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], SandboxController.prototype, "submitMyWallDecision", null);
exports.SandboxController = SandboxController = __decorate([
    (0, common_1.Controller)('sandbox'),
    __metadata("design:paramtypes", [sandbox_service_1.SandboxService])
], SandboxController);
//# sourceMappingURL=sandbox.controller.js.map
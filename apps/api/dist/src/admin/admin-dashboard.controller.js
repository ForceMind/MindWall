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
exports.AdminDashboardController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const admin_guard_1 = require("./admin.guard");
const admin_dashboard_service_1 = require("./admin-dashboard.service");
let AdminDashboardController = class AdminDashboardController {
    adminDashboardService;
    constructor(adminDashboardService) {
        this.adminDashboardService = adminDashboardService;
    }
    async overview() {
        return this.adminDashboardService.getOverview();
    }
    async users(page, limit) {
        return this.adminDashboardService.listUsers(Number(page || 1), Number(limit || 20));
    }
    async userDetail(userId) {
        return this.adminDashboardService.getUserDetail(userId);
    }
    async online(minutes) {
        return this.adminDashboardService.listOnlineUsers(Number(minutes || 5));
    }
    async updateUserStatus(userId, status) {
        return this.adminDashboardService.updateUserStatus(userId, status);
    }
    async aiRecords(page, limit) {
        return this.adminDashboardService.getAiRecords(Number(page || 1), Number(limit || 20));
    }
    async prompts() {
        return this.adminDashboardService.getPrompts();
    }
    async updatePrompt(key, body) {
        return this.adminDashboardService.updatePrompt(key, body);
    }
    async logs(lines) {
        return this.adminDashboardService.getServerLogs(Number(lines || 200));
    }
};
exports.AdminDashboardController = AdminDashboardController;
__decorate([
    (0, common_1.Get)('overview'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('users'),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "users", null);
__decorate([
    (0, common_1.Get)('users/:userId/detail'),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "userDetail", null);
__decorate([
    (0, common_1.Get)('online'),
    __param(0, (0, common_1.Query)('minutes')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "online", null);
__decorate([
    (0, common_1.Put)('users/:userId/status'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)('status', new common_1.ParseEnumPipe(client_1.UserStatus))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "updateUserStatus", null);
__decorate([
    (0, common_1.Get)('ai-records'),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "aiRecords", null);
__decorate([
    (0, common_1.Get)('prompts'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "prompts", null);
__decorate([
    (0, common_1.Put)('prompts/:key'),
    __param(0, (0, common_1.Param)('key')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "updatePrompt", null);
__decorate([
    (0, common_1.Get)('logs'),
    __param(0, (0, common_1.Query)('lines')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "logs", null);
exports.AdminDashboardController = AdminDashboardController = __decorate([
    (0, common_1.Controller)('admin/dashboard'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __metadata("design:paramtypes", [admin_dashboard_service_1.AdminDashboardService])
], AdminDashboardController);
//# sourceMappingURL=admin-dashboard.controller.js.map
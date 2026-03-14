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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const admin_config_service_1 = require("./admin-config.service");
const admin_guard_1 = require("./admin.guard");
let AdminController = class AdminController {
    adminConfigService;
    constructor(adminConfigService) {
        this.adminConfigService = adminConfigService;
    }
    async getConfig() {
        return this.adminConfigService.getPublicConfig();
    }
    async updateConfig(body) {
        const payload = {};
        if (typeof body.openai_base_url === 'string') {
            payload.openai_base_url = body.openai_base_url;
        }
        if (typeof body.openai_api_key === 'string') {
            payload.openai_api_key = body.openai_api_key;
        }
        if (typeof body.openai_model === 'string') {
            payload.openai_model = body.openai_model;
        }
        if (typeof body.openai_embedding_model === 'string') {
            payload.openai_embedding_model = body.openai_embedding_model;
        }
        if (typeof body.web_origin === 'string') {
            payload.web_origin = body.web_origin;
        }
        return this.adminConfigService.updateConfig(payload);
    }
    async testConfig(body) {
        const payload = {};
        if (typeof body.openai_base_url === 'string') {
            payload.openai_base_url = body.openai_base_url;
        }
        if (typeof body.openai_api_key === 'string') {
            payload.openai_api_key = body.openai_api_key;
        }
        if (typeof body.openai_model === 'string') {
            payload.openai_model = body.openai_model;
        }
        if (typeof body.openai_embedding_model === 'string') {
            payload.openai_embedding_model = body.openai_embedding_model;
        }
        return this.adminConfigService.testAiConnectivity(payload);
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getConfig", null);
__decorate([
    (0, common_1.Put)('config'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateConfig", null);
__decorate([
    (0, common_1.Post)('config/test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "testConfig", null);
exports.AdminController = AdminController = __decorate([
    (0, common_1.Controller)('admin'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __metadata("design:paramtypes", [admin_config_service_1.AdminConfigService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map
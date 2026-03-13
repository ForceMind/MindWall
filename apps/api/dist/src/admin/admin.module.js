"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminModule = void 0;
const common_1 = require("@nestjs/common");
const admin_auth_controller_1 = require("./admin-auth.controller");
const admin_auth_service_1 = require("./admin-auth.service");
const admin_dashboard_controller_1 = require("./admin-dashboard.controller");
const admin_dashboard_service_1 = require("./admin-dashboard.service");
const admin_config_service_1 = require("./admin-config.service");
const admin_controller_1 = require("./admin.controller");
const admin_guard_1 = require("./admin.guard");
let AdminModule = class AdminModule {
};
exports.AdminModule = AdminModule;
exports.AdminModule = AdminModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        controllers: [admin_auth_controller_1.AdminAuthController, admin_controller_1.AdminController, admin_dashboard_controller_1.AdminDashboardController],
        providers: [
            admin_auth_service_1.AdminAuthService,
            admin_config_service_1.AdminConfigService,
            admin_dashboard_service_1.AdminDashboardService,
            admin_guard_1.AdminGuard,
        ],
        exports: [admin_auth_service_1.AdminAuthService, admin_config_service_1.AdminConfigService, admin_dashboard_service_1.AdminDashboardService],
    })
], AdminModule);
//# sourceMappingURL=admin.module.js.map
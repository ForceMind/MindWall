"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const admin_module_1 = require("./admin/admin.module");
const auth_module_1 = require("./auth/auth.module");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const companion_module_1 = require("./companion/companion.module");
const match_engine_module_1 = require("./match-engine/match-engine.module");
const onboarding_module_1 = require("./onboarding/onboarding.module");
const prisma_module_1 = require("./prisma/prisma.module");
const sandbox_module_1 = require("./sandbox/sandbox.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            admin_module_1.AdminModule,
            auth_module_1.AuthModule,
            companion_module_1.CompanionModule,
            prisma_module_1.PrismaModule,
            onboarding_module_1.OnboardingModule,
            match_engine_module_1.MatchEngineModule,
            sandbox_module_1.SandboxModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [app_service_1.AppService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map
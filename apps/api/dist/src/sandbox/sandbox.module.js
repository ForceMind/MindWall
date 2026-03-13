"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxModule = void 0;
const common_1 = require("@nestjs/common");
const sandbox_controller_1 = require("./sandbox.controller");
const sandbox_gateway_1 = require("./sandbox.gateway");
const sandbox_service_1 = require("./sandbox.service");
let SandboxModule = class SandboxModule {
};
exports.SandboxModule = SandboxModule;
exports.SandboxModule = SandboxModule = __decorate([
    (0, common_1.Module)({
        controllers: [sandbox_controller_1.SandboxController],
        providers: [sandbox_service_1.SandboxService, sandbox_gateway_1.SandboxGatewayService],
    })
], SandboxModule);
//# sourceMappingURL=sandbox.module.js.map
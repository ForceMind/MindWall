"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelemetryModule = void 0;
const common_1 = require("@nestjs/common");
const ai_usage_service_1 = require("./ai-usage.service");
const prompt_template_service_1 = require("./prompt-template.service");
const server_log_service_1 = require("./server-log.service");
let TelemetryModule = class TelemetryModule {
};
exports.TelemetryModule = TelemetryModule;
exports.TelemetryModule = TelemetryModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [ai_usage_service_1.AiUsageService, prompt_template_service_1.PromptTemplateService, server_log_service_1.ServerLogService],
        exports: [ai_usage_service_1.AiUsageService, prompt_template_service_1.PromptTemplateService, server_log_service_1.ServerLogService],
    })
], TelemetryModule);
//# sourceMappingURL=telemetry.module.js.map
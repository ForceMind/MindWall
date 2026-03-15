"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnboardingDomainModule = void 0;
const common_1 = require("@nestjs/common");
const onboarding_module_1 = require("../../../onboarding/onboarding.module");
let OnboardingDomainModule = class OnboardingDomainModule {
};
exports.OnboardingDomainModule = OnboardingDomainModule;
exports.OnboardingDomainModule = OnboardingDomainModule = __decorate([
    (0, common_1.Module)({
        imports: [onboarding_module_1.OnboardingModule],
        exports: [onboarding_module_1.OnboardingModule],
    })
], OnboardingDomainModule);
//# sourceMappingURL=onboarding-domain.module.js.map
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomainsModule = void 0;
const common_1 = require("@nestjs/common");
const conversation_domain_module_1 = require("./conversation/conversation-domain.module");
const identity_domain_module_1 = require("./identity/identity-domain.module");
const matching_domain_module_1 = require("./matching/matching-domain.module");
const onboarding_domain_module_1 = require("./onboarding/onboarding-domain.module");
let DomainsModule = class DomainsModule {
};
exports.DomainsModule = DomainsModule;
exports.DomainsModule = DomainsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            identity_domain_module_1.IdentityDomainModule,
            onboarding_domain_module_1.OnboardingDomainModule,
            matching_domain_module_1.MatchingDomainModule,
            conversation_domain_module_1.ConversationDomainModule,
        ],
        exports: [
            identity_domain_module_1.IdentityDomainModule,
            onboarding_domain_module_1.OnboardingDomainModule,
            matching_domain_module_1.MatchingDomainModule,
            conversation_domain_module_1.ConversationDomainModule,
        ],
    })
], DomainsModule);
//# sourceMappingURL=domains.module.js.map
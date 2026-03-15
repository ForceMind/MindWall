"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchingDomainModule = void 0;
const common_1 = require("@nestjs/common");
const contacts_module_1 = require("../../../contacts/contacts.module");
const match_engine_module_1 = require("../../../match-engine/match-engine.module");
let MatchingDomainModule = class MatchingDomainModule {
};
exports.MatchingDomainModule = MatchingDomainModule;
exports.MatchingDomainModule = MatchingDomainModule = __decorate([
    (0, common_1.Module)({
        imports: [contacts_module_1.ContactsModule, match_engine_module_1.MatchEngineModule],
        exports: [contacts_module_1.ContactsModule, match_engine_module_1.MatchEngineModule],
    })
], MatchingDomainModule);
//# sourceMappingURL=matching-domain.module.js.map
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendSystemModule = void 0;
const common_1 = require("@nestjs/common");
const domains_module_1 = require("./domains/domains.module");
const foundation_module_1 = require("./foundation/foundation.module");
const platform_module_1 = require("./platform/platform.module");
let BackendSystemModule = class BackendSystemModule {
};
exports.BackendSystemModule = BackendSystemModule;
exports.BackendSystemModule = BackendSystemModule = __decorate([
    (0, common_1.Module)({
        imports: [foundation_module_1.FoundationModule, domains_module_1.DomainsModule, platform_module_1.PlatformModule],
        exports: [foundation_module_1.FoundationModule, domains_module_1.DomainsModule, platform_module_1.PlatformModule],
    })
], BackendSystemModule);
//# sourceMappingURL=backend-system.module.js.map
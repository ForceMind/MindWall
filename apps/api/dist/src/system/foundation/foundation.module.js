"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FoundationModule = void 0;
const common_1 = require("@nestjs/common");
const http_foundation_module_1 = require("./http/http-foundation.module");
const observability_module_1 = require("./observability.module");
const persistence_module_1 = require("./persistence.module");
let FoundationModule = class FoundationModule {
};
exports.FoundationModule = FoundationModule;
exports.FoundationModule = FoundationModule = __decorate([
    (0, common_1.Module)({
        imports: [persistence_module_1.PersistenceModule, observability_module_1.ObservabilityModule, http_foundation_module_1.HttpFoundationModule],
        exports: [persistence_module_1.PersistenceModule, observability_module_1.ObservabilityModule, http_foundation_module_1.HttpFoundationModule],
    })
], FoundationModule);
//# sourceMappingURL=foundation.module.js.map
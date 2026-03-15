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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpLoggingInterceptor = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const server_log_service_1 = require("../../../telemetry/server-log.service");
let HttpLoggingInterceptor = class HttpLoggingInterceptor {
    serverLogService;
    constructor(serverLogService) {
        this.serverLogService = serverLogService;
    }
    intercept(context, next) {
        if (context.getType() !== 'http') {
            return next.handle();
        }
        const req = context.switchToHttp().getRequest();
        const startedAt = req.requestStartedAt || Date.now();
        return next.handle().pipe((0, rxjs_1.tap)({
            next: () => {
                void this.serverLogService.info('http.request', 'request completed', {
                    request_id: req.requestId || null,
                    method: req.method,
                    path: req.originalUrl,
                    duration_ms: Date.now() - startedAt,
                });
            },
        }));
    }
};
exports.HttpLoggingInterceptor = HttpLoggingInterceptor;
exports.HttpLoggingInterceptor = HttpLoggingInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_log_service_1.ServerLogService])
], HttpLoggingInterceptor);
//# sourceMappingURL=http-logging.interceptor.js.map
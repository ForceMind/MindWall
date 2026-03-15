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
exports.GlobalHttpExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const server_log_service_1 = require("../../../telemetry/server-log.service");
let GlobalHttpExceptionFilter = class GlobalHttpExceptionFilter {
    serverLogService;
    constructor(serverLogService) {
        this.serverLogService = serverLogService;
    }
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const request = ctx.getRequest();
        const response = ctx.getResponse();
        const status = exception instanceof common_1.HttpException
            ? exception.getStatus()
            : common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        const payload = exception instanceof common_1.HttpException
            ? exception.getResponse()
            : null;
        const message = this.resolveMessage(payload, exception);
        const errorName = this.resolveErrorName(exception, status);
        void this.serverLogService.error('http.exception', message, {
            request_id: request.requestId || null,
            path: request.originalUrl,
            method: request.method,
            status,
            error: errorName,
            detail: exception instanceof Error
                ? exception.stack?.slice(0, 1000) || exception.message
                : String(exception),
        });
        response.status(status).json({
            statusCode: status,
            error: errorName,
            message,
            request_id: request.requestId || null,
            timestamp: new Date().toISOString(),
            path: request.originalUrl,
        });
    }
    resolveMessage(payload, exception) {
        if (Array.isArray(payload?.message)) {
            return payload.message
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .join('；');
        }
        if (typeof payload?.message === 'string') {
            return String(payload.message);
        }
        if (exception instanceof Error && exception.message) {
            return exception.message;
        }
        return '服务器处理请求失败，请稍后重试。';
    }
    resolveErrorName(exception, status) {
        if (exception instanceof common_1.HttpException &&
            typeof exception.getResponse()?.error === 'string') {
            return String(exception.getResponse().error);
        }
        if (status >= 500) {
            return 'Internal Server Error';
        }
        return 'Bad Request';
    }
};
exports.GlobalHttpExceptionFilter = GlobalHttpExceptionFilter;
exports.GlobalHttpExceptionFilter = GlobalHttpExceptionFilter = __decorate([
    (0, common_1.Injectable)(),
    (0, common_1.Catch)(),
    __metadata("design:paramtypes", [server_log_service_1.ServerLogService])
], GlobalHttpExceptionFilter);
//# sourceMappingURL=global-http-exception.filter.js.map
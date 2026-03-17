"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@nestjs/core");
const admin_config_service_1 = require("./admin/admin-config.service");
const app_module_1 = require("./app.module");
const global_http_exception_filter_1 = require("./system/foundation/http/global-http-exception.filter");
const http_logging_interceptor_1 = require("./system/foundation/http/http-logging.interceptor");
const request_context_middleware_1 = require("./system/foundation/http/request-context.middleware");
function normalizeOrigin(value) {
    if (!value || !value.trim()) {
        return null;
    }
    try {
        const parsed = new URL(value.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        const protocol = parsed.protocol.toLowerCase();
        const hostname = parsed.hostname.toLowerCase();
        const port = parsed.port;
        return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
    }
    catch {
        return null;
    }
}
function parseCsvOrigins(raw) {
    if (!raw) {
        return [];
    }
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function isLocalDevOrigin(origin) {
    try {
        const parsed = new URL(origin);
        const hostname = parsed.hostname;
        if (hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1') {
            return true;
        }
        if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
            return true;
        }
        if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
            return true;
        }
        if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
            return true;
        }
        return false;
    }
    catch {
        return false;
    }
}
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.use(request_context_middleware_1.requestContextMiddleware);
    app.useGlobalFilters(app.get(global_http_exception_filter_1.GlobalHttpExceptionFilter));
    app.useGlobalInterceptors(app.get(http_logging_interceptor_1.HttpLoggingInterceptor));
    app.enableShutdownHooks();
    const adminConfigService = app.get(admin_config_service_1.AdminConfigService);
    const aiConfig = await adminConfigService.getAiConfig();
    const rawAllowedOrigins = [
        aiConfig.webOrigin,
        process.env.WEB_ORIGIN,
        process.env.PUBLIC_HOST ? `http://${process.env.PUBLIC_HOST}` : undefined,
        process.env.PUBLIC_HOST ? `https://${process.env.PUBLIC_HOST}` : undefined,
        ...parseCsvOrigins(process.env.CORS_ALLOWED_ORIGINS),
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
    ].filter((item) => Boolean(item && item.trim()));
    const allowedOrigins = new Set();
    for (const item of rawAllowedOrigins) {
        const normalized = normalizeOrigin(item);
        if (normalized) {
            allowedOrigins.add(normalized);
        }
    }
    app.enableCors({
        origin: (origin, callback) => {
            if (!origin) {
                callback(null, true);
                return;
            }
            const normalizedOrigin = normalizeOrigin(origin);
            if ((normalizedOrigin && allowedOrigins.has(normalizedOrigin)) ||
                isLocalDevOrigin(origin)) {
                callback(null, true);
                return;
            }
            callback(new Error(`CORS blocked for origin: ${origin}`), false);
        },
        credentials: true,
    });
    await app.listen(process.env.PORT ?? 3100, '127.0.0.1');
}
bootstrap();
//# sourceMappingURL=main.js.map
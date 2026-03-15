"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@nestjs/core");
const admin_config_service_1 = require("./admin/admin-config.service");
const app_module_1 = require("./app.module");
const global_http_exception_filter_1 = require("./system/foundation/http/global-http-exception.filter");
const http_logging_interceptor_1 = require("./system/foundation/http/http-logging.interceptor");
const request_context_middleware_1 = require("./system/foundation/http/request-context.middleware");
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
    const allowedOrigins = new Set([
        aiConfig.webOrigin,
        process.env.WEB_ORIGIN,
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
    ].filter((item) => Boolean(item && item.trim())));
    app.enableCors({
        origin: (origin, callback) => {
            if (!origin) {
                callback(null, true);
                return;
            }
            if (allowedOrigins.has(origin) || isLocalDevOrigin(origin)) {
                callback(null, true);
                return;
            }
            callback(new Error(`CORS blocked for origin: ${origin}`), false);
        },
        credentials: true,
    });
    await app.listen(process.env.PORT ?? 3100);
}
bootstrap();
//# sourceMappingURL=main.js.map
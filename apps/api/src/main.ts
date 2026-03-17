import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AdminConfigService } from './admin/admin-config.service';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './system/foundation/http/global-http-exception.filter';
import { HttpLoggingInterceptor } from './system/foundation/http/http-logging.interceptor';
import { requestContextMiddleware } from './system/foundation/http/request-context.middleware';

function normalizeOrigin(value: string | undefined | null) {
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
  } catch {
    return null;
  }
}

function parseCsvOrigins(raw: string | undefined) {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLocalDevOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1'
    ) {
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
  } catch {
    return false;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(requestContextMiddleware);
  app.useGlobalFilters(app.get(GlobalHttpExceptionFilter));
  app.useGlobalInterceptors(app.get(HttpLoggingInterceptor));
  app.enableShutdownHooks();

  const adminConfigService = app.get(AdminConfigService);
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
    ].filter((item): item is string => Boolean(item && item.trim()));
  const allowedOrigins = new Set<string>();
  for (const item of rawAllowedOrigins) {
    const normalized = normalizeOrigin(item);
    if (normalized) {
      allowedOrigins.add(normalized);
    }
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = normalizeOrigin(origin);
      if (
        (normalizedOrigin && allowedOrigins.has(normalizedOrigin)) ||
        isLocalDevOrigin(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
  });

  // 绑定 127.0.0.1：API 不直接对外暴露，通过 nginx /api/ 代理访问
  await app.listen(process.env.PORT ?? 3100, '127.0.0.1');
}

bootstrap();

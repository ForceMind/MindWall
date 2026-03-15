import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AdminConfigService } from './admin/admin-config.service';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './system/foundation/http/global-http-exception.filter';
import { HttpLoggingInterceptor } from './system/foundation/http/http-logging.interceptor';
import { requestContextMiddleware } from './system/foundation/http/request-context.middleware';

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
  const allowedOrigins = new Set(
    [
      aiConfig.webOrigin,
      process.env.WEB_ORIGIN,
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
    ].filter((item): item is string => Boolean(item && item.trim())),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
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

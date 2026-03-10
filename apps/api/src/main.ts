import { NestFactory } from '@nestjs/core';
import { AdminConfigService } from './admin/admin-config.service';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const adminConfigService = app.get(AdminConfigService);
  const aiConfig = await adminConfigService.getAiConfig();
  const allowedOrigins = Array.from(
    new Set(
      [
        aiConfig.webOrigin,
        process.env.WEB_ORIGIN,
        'http://localhost:3000',
        'http://localhost:3001',
      ].filter((item): item is string => Boolean(item && item.trim())),
    ),
  );

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

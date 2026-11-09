// Sentry phải khởi tạo trước mọi import khác (no-op khi không có SENTRY_DSN).
import './instrument';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { setupHttpSecurity, setupRealtime, setupStaticUploads } from './app.setup';
import { isSwaggerEnabled, SWAGGER_PATH } from './common/http/security';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('v1');
  setupHttpSecurity(app);
  setupStaticUploads(app);
  setupRealtime(app);

  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Tenant-Id',
      'X-Venue-Id',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    // Web đọc được Retry-After khi bị 429.
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });

  const swaggerOn = isSwaggerEnabled(
    config.get<string>('NODE_ENV'),
    config.get<boolean>('SWAGGER_ENABLED'),
  );
  if (swaggerOn) {
    const swagger = new DocumentBuilder()
      .setTitle('OrderGo API')
      .setDescription('REST API cho OrderGo platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup(SWAGGER_PATH, app, doc);
  }

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
  Logger.log(`OrderGo API listening on http://localhost:${port}`, 'Bootstrap');
  Logger.log(
    swaggerOn
      ? `Swagger UI:   http://localhost:${port}/${SWAGGER_PATH}`
      : 'Swagger UI tắt (bật bằng SWAGGER_ENABLED=1)',
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});

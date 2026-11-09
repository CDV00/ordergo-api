import type { ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JSON_BODY_LIMIT, parseTrustProxy, securityHeaders } from './common/http/security';
import { StorageService, UPLOADS_URL_PREFIX } from './modules/storage/storage.service';
import { RealtimeIoAdapter } from './modules/realtime/realtime-io.adapter';

/**
 * Bảo mật tầng HTTP: trust proxy (req.ip = IP khách sau Caddy), helmet, giới hạn body.
 * Gọi TRƯỚC setupStaticUploads để /uploads cũng có header helmet (CORP được ghi đè ở đó).
 */
export function setupHttpSecurity(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  const trustProxy = parseTrustProxy(config.get<string>('TRUST_PROXY'));
  app.set('trust proxy', trustProxy);
  if (config.get<string>('NODE_ENV') === 'production' && trustProxy === false) {
    new Logger('Bootstrap').warn(
      'TRUST_PROXY chưa đặt: sau reverse proxy mọi request sẽ chung IP của proxy → rate limit theo IP ' +
        'dồn về một khách. Đặt TRUST_PROXY=1 khi chạy sau Caddy.',
    );
  }

  app.use(securityHeaders());
  // Nest bỏ qua parser mặc định cùng loại khi đã đăng ký ở đây.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });
}

/** Phục vụ ảnh đã upload tại /uploads (ngoài prefix /v1). Dùng chung cho main.ts và e2e. */
export function setupStaticUploads(app: NestExpressApplication): void {
  const storage = app.get(StorageService);
  app.useStaticAssets(storage.rootDir, {
    prefix: `${UPLOADS_URL_PREFIX}/`,
    maxAge: '30d',
    immutable: true, // tên file là UUID → không bao giờ đổi nội dung
    index: false,
    dotfiles: 'deny',
    setHeaders: (res: ServerResponse) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });
}

/** Socket.IO (namespace /realtime) dùng CORS_ORIGINS như REST. Dùng chung cho main.ts và e2e. */
export function setupRealtime(app: NestExpressApplication): void {
  app.useWebSocketAdapter(new RealtimeIoAdapter(app));
}

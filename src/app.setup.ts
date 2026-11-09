import type { ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { StorageService, UPLOADS_URL_PREFIX } from './modules/storage/storage.service';

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

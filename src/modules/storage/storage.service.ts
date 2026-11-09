import { BadRequestException, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { newId } from '../../shared/utils/uuid';
import { detectImageType } from './image-type';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const UPLOADS_URL_PREFIX = '/uploads';

/**
 * Lưu ảnh lên ổ đĩa của API (thư mục UPLOAD_DIR, mặc định ./uploads), phục vụ tĩnh tại /uploads.
 * Đủ cho demo / 1 instance. Nhiều instance → thay bằng adapter S3/R2 giữ nguyên interface `saveImage`.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger('Storage');
  readonly rootDir: string;

  constructor(config: ConfigService) {
    this.rootDir = resolve(config.get<string>('UPLOAD_DIR') ?? 'uploads');
  }

  /** Lưu ảnh của tenant, trả về đường dẫn tương đối (vd `/uploads/<tenantId>/<id>.webp`). */
  async saveImage(tenantId: string, buf: Buffer): Promise<{ url: string; bytes: number }> {
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: 'Ảnh tối đa 2MB.',
      });
    }
    const type = detectImageType(buf);
    if (!type) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_IMAGE',
        message: 'Chỉ nhận ảnh JPG, PNG hoặc WEBP.',
      });
    }
    // tenantId là UUID do server sinh — vẫn lọc ký tự để chắc chắn không thoát khỏi rootDir
    const safeTenant = tenantId.replace(/[^a-zA-Z0-9-]/g, '');
    const dir = join(this.rootDir, safeTenant);
    await mkdir(dir, { recursive: true });
    const name = `${newId()}.${type.ext}`;
    await writeFile(join(dir, name), buf);
    this.logger.log(`Saved ${name} (${buf.length} bytes) for tenant ${safeTenant}`);
    return { url: `${UPLOADS_URL_PREFIX}/${safeTenant}/${name}`, bytes: buf.length };
  }
}

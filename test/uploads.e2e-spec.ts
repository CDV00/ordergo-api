import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapApp, login, Owner, randomPhone, registerOwner } from './helpers';
import { MembershipRepository } from '../src/modules/tenant/repositories/membership.repository';

// PNG 1×1 hợp lệ
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Upload ảnh (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Owner;
  const uploadDir = mkdtempSync(join(tmpdir(), 'ordergo-uploads-'));
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.UPLOAD_DIR = uploadDir;
    app = await bootstrapApp('ordergo_e2e_uploads');
    owner = await registerOwner(app, 'Upload');
  });

  afterAll(async () => {
    await app?.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('upload PNG → phục vụ tĩnh đúng content-type + nosniff', async () => {
    const res = await http()
      .post('/v1/uploads/images')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', PNG_1X1, { filename: 'mon.png', contentType: 'image/png' })
      .expect(201);
    const url: string = res.body.data.url;
    expect(url).toMatch(new RegExp(`^/uploads/${owner.tenantId}/[0-9a-f-]+\\.png$`));

    const file = await http().get(url).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('từ chối file không phải ảnh dù đặt tên .png / mimetype ảnh', async () => {
    const res = await http()
      .post('/v1/uploads/images')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'evil.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_IMAGE');
  });

  it('từ chối ảnh > 2MB', async () => {
    const big = Buffer.concat([PNG_1X1, Buffer.alloc(2 * 1024 * 1024)]);
    await http()
      .post('/v1/uploads/images')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' })
      .expect(413);
  });

  it('phục vụ (không có menu.manage) không upload được', async () => {
    const phone = randomPhone();
    const reg = await http()
      .post('/v1/auth/register')
      .send({ phone, password: 'matkhau123', displayName: 'Phục vụ' })
      .expect(201);
    await app.get(MembershipRepository).create({
      tenantId: owner.tenantId,
      userId: reg.body.data.user.id,
      venueId: owner.venueId,
      roleCode: 'server',
    });
    await http()
      .post('/v1/uploads/images')
      .set('Authorization', `Bearer ${await login(app, phone)}`)
      .attach('file', PNG_1X1, { filename: 'mon.png', contentType: 'image/png' })
      .expect(403);
  });
});

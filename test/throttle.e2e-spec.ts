import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { bootstrapApp, randomPhone } from './helpers';
import { RATE_LIMITS, TOO_MANY_REQUESTS_MESSAGE } from '../src/common/throttle/throttle';

/** Suite duy nhất BẬT rate limit (các suite khác đặt THROTTLE_DISABLED=1 qua helpers). */
describe('Bảo mật HTTP: rate limit + helmet + body limit (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '0';
    app = await bootstrapApp('ordergo_e2e_throttle');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('header bảo mật (helmet) trên API JSON', async () => {
    const res = await http().get('/v1/health').expect(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('/v1/health không bị rate limit', async () => {
    for (let i = 0; i < RATE_LIMITS.default + 20; i++) {
      await http().get('/v1/health').expect(200);
    }
  });

  it(`login: quá ${RATE_LIMITS.login} lần/phút/IP → 429 TOO_MANY_REQUESTS`, async () => {
    // Mỗi lần một SĐT khác → không dính khoá theo tài khoản, chỉ test giới hạn theo IP.
    for (let i = 0; i < RATE_LIMITS.login; i++) {
      await http()
        .post('/v1/auth/login')
        .send({ phone: randomPhone(), password: 'saimatkhau' })
        .expect(401);
    }
    const res = await http()
      .post('/v1/auth/login')
      .send({ phone: randomPhone(), password: 'saimatkhau' })
      .expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(res.body.error.message).toBe(TOO_MANY_REQUESTS_MESSAGE);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('bộ đếm tách theo route: login bị chặn không ảnh hưởng /auth/refresh', async () => {
    const res = await http().post('/v1/auth/refresh').send({ refreshToken: 'khong-ton-tai' });
    expect(res.status).toBe(401);
  });

  it('body JSON > 100kb → 413', async () => {
    const res = await http()
      .post('/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ phone: randomPhone(), password: 'x'.repeat(150 * 1024) }))
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('JSON hỏng → 400 (không phải 500)', async () => {
    const res = await http()
      .post('/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"phone":')
      .expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});

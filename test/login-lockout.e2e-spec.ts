import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { bootstrapApp, randomPhone } from './helpers';

/** Khoá đăng nhập theo tài khoản (Mongo `login_attempts`) — chạy với rate limit IP đã tắt. */
describe('Khoá đăng nhập theo SĐT (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const attempts = () => app.get<Connection>(getConnectionToken()).collection('login_attempts');

  async function register(): Promise<string> {
    const phone = randomPhone();
    await http()
      .post('/v1/auth/register')
      .send({ phone, password: 'matkhau123', displayName: 'Khoá thử' })
      .expect(201);
    return phone;
  }

  const loginAs = (phone: string, password: string) =>
    http().post('/v1/auth/login').send({ phone, password });

  beforeAll(async () => {
    app = await bootstrapApp('ordergo_e2e_lockout');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sai 5 lần → khoá 15 phút kể cả mật khẩu đúng; tài khoản khác không ảnh hưởng', async () => {
    const phone = await register();
    const other = await register();

    for (let i = 0; i < 5; i++) await loginAs(phone, 'saimatkhau').expect(401);

    const locked = await loginAs(phone, 'matkhau123').expect(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED_TEMPORARILY');
    expect(locked.body.error.message).toMatch(/thử lại sau 15 phút/);
    expect(locked.body.error.details.retryAfterSeconds).toBeGreaterThan(14 * 60);

    await loginAs(other, 'matkhau123').expect(201);

    // Không lưu SĐT dạng rõ
    const docs = await attempts().find({}).toArray();
    expect(JSON.stringify(docs)).not.toContain(phone.slice(1));
  });

  it('hết thời gian khoá → đăng nhập đúng được và bộ đếm bị xoá', async () => {
    const phone = await register();
    for (let i = 0; i < 5; i++) await loginAs(phone, 'saimatkhau').expect(401);
    await loginAs(phone, 'matkhau123').expect(429);

    const past = new Date(Date.now() - 20 * 60_000);
    await attempts().updateMany(
      { lockedUntil: { $ne: null } },
      { $set: { lockedUntil: past, windowStart: past } },
    );

    await loginAs(phone, 'matkhau123').expect(201);
    // Lần sai tiếp theo bắt đầu cửa sổ mới (1/5), chưa khoá
    await loginAs(phone, 'saimatkhau').expect(401);
    await loginAs(phone, 'matkhau123').expect(201);
  });

  it('đăng nhập đúng reset bộ đếm: 4 sai + 1 đúng + 4 sai → chưa khoá', async () => {
    const phone = await register();
    for (let i = 0; i < 4; i++) await loginAs(phone, 'saimatkhau').expect(401);
    await loginAs(phone, 'matkhau123').expect(201);
    for (let i = 0; i < 4; i++) await loginAs(phone, 'saimatkhau').expect(401);
    await loginAs(phone, 'matkhau123').expect(201);
  });

  it('SĐT chưa đăng ký cũng bị đếm (không lộ SĐT nào tồn tại)', async () => {
    const phone = randomPhone();
    for (let i = 0; i < 5; i++) await loginAs(phone, 'saimatkhau').expect(401);
    const res = await loginAs(phone, 'saimatkhau').expect(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED_TEMPORARILY');
  });
});

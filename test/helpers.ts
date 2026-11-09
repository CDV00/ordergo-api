import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/**
 * Khởi động app với DB riêng cho từng file e2e (jest chạy song song nhiều file).
 * Gọi TRƯỚC khi import AppModule — ConfigModule đọc env lúc import.
 */
export async function bootstrapApp(dbName: string): Promise<INestApplication<App>> {
  process.env.MONGODB_URI =
    process.env.E2E_MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true';
  process.env.MONGODB_DB = dbName;
  process.env.NODE_ENV = 'test';
  // Các suite đăng ký/đăng nhập rất nhiều từ 127.0.0.1 → tắt rate limit, trừ file tự bật
  // (throttle.e2e-spec.ts đặt THROTTLE_DISABLED=0 trước khi gọi).
  process.env.THROTTLE_DISABLED ??= '1';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('v1');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const setup = require('../src/app.setup') as typeof import('../src/app.setup');
  const { setupHttpSecurity, setupRealtime, setupStaticUploads } = setup;
  setupHttpSecurity(app);
  setupStaticUploads(app);
  setupRealtime(app);
  await app.init();
  await app.get<Connection>(getConnectionToken()).dropDatabase();
  return app as unknown as INestApplication<App>;
}

export function randomPhone(): string {
  return '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
}

export interface Owner {
  token: string;
  userId: string;
  tenantId: string;
  venueId: string;
  phone: string;
}

/** Đăng ký → setup wizard → login lại để JWT mang tenant + quyền owner. */
export async function registerOwner(app: INestApplication<App>, name: string): Promise<Owner> {
  const http = () => request(app.getHttpServer());
  const phone = randomPhone();
  const reg = await http()
    .post('/v1/auth/register')
    .send({ phone, password: 'matkhau123', displayName: name })
    .expect(201);
  const setup = await http()
    .post('/v1/setup-wizard')
    .set('Authorization', `Bearer ${reg.body.data.tokens.accessToken}`)
    .send({
      tenantName: `Quán ${name}`,
      venueName: `Chi nhánh ${name}`,
      venueCode: 'CN1',
      businessType: 'cafe',
    })
    .expect(201);
  const login = await http()
    .post('/v1/auth/login')
    .send({ phone, password: 'matkhau123' })
    .expect(201);
  return {
    token: login.body.data.tokens.accessToken,
    userId: reg.body.data.user.id,
    tenantId: setup.body.data.tenant.id,
    venueId: setup.body.data.venue.id,
    phone,
  };
}

export async function login(app: INestApplication<App>, phone: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/v1/auth/login')
    .send({ phone, password: 'matkhau123' })
    .expect(201);
  return res.body.data.tokens.accessToken;
}

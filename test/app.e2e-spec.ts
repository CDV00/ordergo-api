import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/**
 * E2E chạy với Mongo thật. Mặc định: Mongo của docker-compose.infra.yml ở localhost:27017.
 * Máy khác port → đặt E2E_MONGODB_URI. DB riêng `ordergo_e2e`, bị xoá trước mỗi lần chạy.
 */
process.env.MONGODB_URI =
  process.env.E2E_MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true';
process.env.MONGODB_DB = 'ordergo_e2e';
process.env.NODE_ENV = 'test';
process.env.THROTTLE_DISABLED = '1';

// Import sau khi set env để ConfigModule đọc đúng giá trị.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');

interface Owner {
  token: string;
  tenantId: string;
  venueId: string;
}

function randomPhone(): string {
  return '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
}

describe('OrderGo API (e2e)', () => {
  let app: INestApplication<App>;
  let ownerA: Owner;
  let ownerB: Owner;

  const http = () => request(app.getHttpServer());

  /** Đăng ký → setup wizard → login lại để có JWT mang tenant + quyền owner ('*'). */
  async function registerOwner(name: string): Promise<Owner> {
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
    expect(login.body.data.membership.tenantId).toBe(setup.body.data.tenant.id);
    expect(login.body.data.membership.permissions).toEqual(['*']);

    return {
      token: login.body.data.tokens.accessToken,
      tenantId: setup.body.data.tenant.id,
      venueId: setup.body.data.venue.id,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    await app.get<Connection>(getConnectionToken()).dropDatabase();

    ownerA = await registerOwner('An');
    ownerB = await registerOwner('Bình');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /v1/health', async () => {
    const res = await http().get('/v1/health').expect(200);
    expect(res.body.data.status).toBe('ok');
  });

  describe('Cách ly tenant qua header X-Tenant-Id / X-Venue-Id', () => {
    it('owner truy cập tenant của mình', async () => {
      await http()
        .get('/v1/tables')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('X-Tenant-Id', ownerA.tenantId)
        .expect(200);
    });

    it('owner A đọc dữ liệu tenant B → 403', async () => {
      const res = await http()
        .get('/v1/tables')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('X-Tenant-Id', ownerB.tenantId)
        .expect(403);
      expect(res.body.error.code).toBe('TENANT_ACCESS_DENIED');
    });

    it('owner A ghi dữ liệu vào tenant B → 403, không tạo bản ghi', async () => {
      await http()
        .post('/v1/tables')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('X-Tenant-Id', ownerB.tenantId)
        .send({ venueId: ownerB.venueId, name: 'Bàn lạ' })
        .expect(403);

      const list = await http()
        .get('/v1/tables')
        .set('Authorization', `Bearer ${ownerB.token}`)
        .set('X-Tenant-Id', ownerB.tenantId)
        .expect(200);
      expect(list.body.data).toHaveLength(0);
    });

    it('owner A trỏ X-Venue-Id sang venue của tenant B → 403', async () => {
      const res = await http()
        .get('/v1/tables')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('X-Tenant-Id', ownerA.tenantId)
        .set('X-Venue-Id', ownerB.venueId)
        .expect(403);
      expect(res.body.error.code).toBe('VENUE_ACCESS_DENIED');
    });

    it('không gửi header → dùng tenant trong JWT, chỉ thấy dữ liệu của mình', async () => {
      await http()
        .post('/v1/tables')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ venueId: ownerA.venueId, name: 'Bàn 1' })
        .expect(201);
      const mine = await http()
        .get('/v1/tables')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .expect(200);
      expect(mine.body.data.map((t: { name: string }) => t.name)).toEqual(['Bàn 1']);

      const other = await http()
        .get('/v1/tables')
        .set('Authorization', `Bearer ${ownerB.token}`)
        .expect(200);
      expect(other.body.data).toHaveLength(0);
    });
  });
});

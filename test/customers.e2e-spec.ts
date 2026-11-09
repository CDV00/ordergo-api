import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { bootstrapApp, login, Owner, randomPhone, registerOwner } from './helpers';
import { MembershipRepository } from '../src/modules/tenant/repositories/membership.repository';
import { CustomerDoc } from '../src/modules/customer/schemas/customer.schema';
import { CustomerRepository } from '../src/modules/customer/repositories/customer.repository';
import { AuditLogDoc } from '../src/modules/audit/audit.module';
import { LoyaltyCardDoc } from '../src/modules/loyalty/schemas/loyalty-card.schema';
import { LoyaltyTxDoc } from '../src/modules/loyalty/schemas/loyalty-transaction.schema';
import { OrderDoc } from '../src/modules/order/schemas/order.schema';
import { newId } from '../src/shared/utils/uuid';

/**
 * Quản lý khách hàng: PII che mặc định, reveal có quyền + audit + giới hạn, cô lập tenant,
 * ẩn danh hoá giữ thống kê. Dữ liệu khách là tổng hợp (không phải người thật).
 */
describe('Customers (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Owner;
  let other: Owner;
  let customers: Model<CustomerDoc>;
  let audits: Model<AuditLogDoc>;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${token}`),
  });

  /** Khách đã xác thực (verified) với thống kê cố định. */
  async function seedCustomer(
    tenantId: string,
    data: {
      name: string;
      phone: string;
      email?: string;
      spent: number;
      visits: number;
      last: Date;
    },
  ): Promise<string> {
    const anon = await app.get(CustomerRepository).createAnonymous({
      tenantId,
      cookieAnchor: newId(),
      deviceFingerprint: 'fp-test',
    });
    await customers.updateOne(
      { id: anon.id },
      {
        $set: {
          status: 'verified',
          userId: newId(),
          name: data.name,
          phone: data.phone,
          email: data.email ?? null,
          birthday: new Date('1992-03-04T00:00:00.000Z'),
          tags: ['VIP'],
          note: 'Thích ít đá',
          'stats.totalSpent.amount': data.spent,
          'stats.orderCount': data.visits,
          'stats.firstOrderAt': new Date('2026-01-01T00:00:00Z'),
          'stats.lastOrderAt': data.last,
        },
      },
    );
    return anon.id;
  }

  async function addStaff(roleCode: 'venue_manager' | 'cashier' | 'tenant_admin') {
    const phone = randomPhone();
    const reg = await http()
      .post('/v1/auth/register')
      .send({ phone, password: 'matkhau123', displayName: roleCode })
      .expect(201);
    await app.get(MembershipRepository).create({
      tenantId: owner.tenantId,
      userId: reg.body.data.user.id,
      venueId: roleCode === 'tenant_admin' ? null : owner.venueId,
      roleCode,
    });
    return login(app, phone);
  }

  let lanId: string;
  let dotId: string;
  let anonId: string;
  let managerToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    app = await bootstrapApp('ordergo_e2e_customers');
    customers = app.get<Model<CustomerDoc>>(getModelToken(CustomerDoc.name));
    audits = app.get<Model<AuditLogDoc>>(getModelToken(AuditLogDoc.name));
    owner = await registerOwner(app, 'Customers');
    other = await registerOwner(app, 'Khác');
    managerToken = await addStaff('venue_manager');
    cashierToken = await addStaff('cashier');

    lanId = await seedCustomer(owner.tenantId, {
      name: 'Trần Thị Lan',
      phone: '+84901110001',
      email: 'lan.tran@example.com',
      spent: 1_250_000,
      visits: 5,
      last: new Date('2026-11-05T10:00:00Z'),
    });
    dotId = await seedCustomer(owner.tenantId, {
      name: 'Bé.Na (VIP)*',
      phone: '+84901110002',
      spent: 50_000,
      visits: 1,
      last: new Date('2026-11-08T10:00:00Z'),
    });
    anonId = (
      await app.get(CustomerRepository).createAnonymous({
        tenantId: owner.tenantId,
        cookieAnchor: newId(),
      })
    ).id;
    // Khách ở tenant khác có cùng tên — không được lọt vào danh sách
    await seedCustomer(other.tenantId, {
      name: 'Trần Thị Lan',
      phone: '+84901110001',
      spent: 1,
      visits: 1,
      last: new Date(),
    });

    // Thẻ thành viên + giao dịch điểm + đơn của Lan
    const cardId = newId();
    await app.get<Model<LoyaltyCardDoc>>(getModelToken(LoyaltyCardDoc.name)).create({
      id: cardId,
      tenantId: owner.tenantId,
      customerId: lanId,
      cardNumber: `OG-TEST-${cardId.slice(-6)}`,
      tier: 'silver',
      points: 1250,
      pointsLifetime: 1250,
      spentLifetime: 1_250_000,
    });
    await app.get<Model<LoyaltyTxDoc>>(getModelToken(LoyaltyTxDoc.name)).create({
      id: newId(),
      tenantId: owner.tenantId,
      cardId,
      customerId: lanId,
      type: 'earn',
      points: 1250,
      reason: 'Order test',
      referenceType: 'order',
      referenceId: 'o-1',
      balanceAfter: 1250,
    });
    await app.get<Model<OrderDoc>>(getModelToken(OrderDoc.name)).create({
      id: newId(),
      tenantId: owner.tenantId,
      venueId: owner.venueId,
      orderNumber: 'T-0001',
      orderType: 'takeaway',
      customerId: lanId,
      customerSnapshot: { name: 'Trần Thị Lan', phone: '+84901110001' },
      status: 'paid',
      pricing: {
        subtotal: { amount: 1_250_000, currency: 'VND' },
        total: { amount: 1_250_000, currency: 'VND' },
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('danh sách chỉ trả giá trị đã che, sắp theo lần ghé gần nhất, có phân trang', async () => {
    const res = await as(cashierToken).get('/v1/customers').expect(200);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, total: 3 });
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual([dotId, lanId, anonId]);
    const lan = rows[1];
    expect(lan.name).toBe('Trần T** L**');
    expect(lan.phone).toBe('090****001');
    expect(lan.visits).toBe(5);
    expect(lan.loyalty).toEqual({ tier: 'silver', points: 1250 });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('Thị Lan');
    expect(json).not.toContain('901110001');
    expect(json).not.toContain('lan.tran');

    const paged = await as(owner.token).get('/v1/customers?page=2&pageSize=2').expect(200);
    expect(paged.body.pagination).toEqual({ page: 2, pageSize: 2, total: 3 });
    expect(paged.body.data).toHaveLength(1);

    const verified = await as(owner.token).get('/v1/customers?status=verified').expect(200);
    expect(verified.body.pagination.total).toBe(2);
  });

  it('tìm theo SĐT (khớp chính xác, chuẩn hoá) và theo tên có ký tự regex', async () => {
    const byPhone = await as(owner.token)
      .get('/v1/customers')
      .query({ q: '090 111 0001' })
      .expect(200);
    expect(byPhone.body.data.map((r: { id: string }) => r.id)).toEqual([lanId]);

    const partialPhone = await as(owner.token)
      .get('/v1/customers')
      .query({ q: '0901110' })
      .expect(200);
    expect(partialPhone.body.data).toHaveLength(0);

    const byName = await as(owner.token).get('/v1/customers').query({ q: 'thị lan' }).expect(200);
    expect(byName.body.data.map((r: { id: string }) => r.id)).toEqual([lanId]);

    const regexChars = await as(owner.token)
      .get('/v1/customers')
      .query({ q: 'na (vip)*' })
      .expect(200);
    expect(regexChars.body.data.map((r: { id: string }) => r.id)).toEqual([dotId]);

    // ".*" chỉ là chuỗi ký tự thường, không phải "khớp tất cả"
    const dotStar = await as(owner.token).get('/v1/customers').query({ q: '.*' }).expect(200);
    expect(dotStar.body.data).toHaveLength(0);
  });

  it('chi tiết: hồ sơ đã che + thẻ thành viên + giao dịch + đơn gần đây', async () => {
    const res = await as(cashierToken).get(`/v1/customers/${lanId}`).expect(200);
    const d = res.body.data;
    expect(d.name).toBe('Trần T** L**');
    expect(d.email).toBe('l*******@example.com');
    expect(d.birthday).toBe('**/**/1992');
    expect(d.tags).toEqual(['VIP']);
    expect(d.loyalty).toEqual({
      tier: 'silver',
      points: 1250,
      pointsLifetime: 1250,
      spentLifetime: 1_250_000,
    });
    expect(d.transactions).toHaveLength(1);
    expect(d.recentOrders).toEqual([
      expect.objectContaining({
        orderNumber: 'T-0001',
        total: { amount: 1_250_000, currency: 'VND' },
        status: 'paid',
      }),
    ]);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('901110001');
    expect(json).not.toContain('1992-03-04');
  });

  it('chủ quán xem thông tin đầy đủ → trả giá trị gốc + ghi audit không chứa PII', async () => {
    const res = await as(owner.token).post(`/v1/customers/${lanId}/reveal`).expect(200);
    expect(res.body.data).toEqual({
      name: 'Trần Thị Lan',
      phone: '+84901110001',
      email: 'lan.tran@example.com',
      birthday: '1992-03-04',
    });
    const rows = await audits.find({ action: 'customer.reveal', entityId: lanId }).lean().exec();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: owner.tenantId,
      userId: owner.userId,
      entityType: 'customer',
    });
    const json = JSON.stringify(rows);
    expect(json).not.toContain('Lan');
    expect(json).not.toContain('901110001');
    expect(json).not.toContain('lan.tran');
    expect(json).not.toContain('1992');
  });

  it('quản lý và thu ngân không được xem thông tin đầy đủ → 403', async () => {
    await as(managerToken).post(`/v1/customers/${lanId}/reveal`).expect(403);
    await as(cashierToken).post(`/v1/customers/${lanId}/reveal`).expect(403);
    // quản lý vẫn xem danh sách (order.manage ⊇ order.pay)
    await as(managerToken).get('/v1/customers').expect(200);
  });

  it(`giới hạn 30 lần xem/giờ → 429 REVEAL_LIMIT`, async () => {
    const adminToken = await addStaff('tenant_admin');
    await as(adminToken).post(`/v1/customers/${lanId}/reveal`).expect(200);
    const [row] = await audits
      .find({ action: 'customer.reveal', tenantId: owner.tenantId })
      .sort({ timestamp: -1 })
      .limit(1)
      .lean()
      .exec();
    const adminUserId = row.userId;
    expect(adminUserId).not.toBe(owner.userId);
    // Đã có 1 lần; thêm 29 dòng audit để chạm ngưỡng 30
    await audits.insertMany(
      Array.from({ length: 29 }, () => ({
        id: newId(),
        tenantId: owner.tenantId,
        userId: adminUserId,
        action: 'customer.reveal',
        entityType: 'customer',
        entityId: lanId,
        metadata: {},
        timestamp: new Date(),
      })),
    );
    const res = await as(adminToken).post(`/v1/customers/${lanId}/reveal`).expect(429);
    expect(res.body.error.code).toBe('REVEAL_LIMIT');
    expect(res.body.error.message).toContain('30');
    // chủ quán (người khác) không bị ảnh hưởng
    await as(owner.token).post(`/v1/customers/${dotId}/reveal`).expect(200);
  });

  it('id khách của tenant khác → 404 ở mọi endpoint', async () => {
    const o = as(other.token);
    await o.get(`/v1/customers/${lanId}`).expect(404);
    await o.post(`/v1/customers/${lanId}/reveal`).expect(404);
    await o.patch(`/v1/customers/${lanId}`).send({ note: 'x' }).expect(404);
    await o.post(`/v1/customers/${lanId}/anonymize`).expect(404);
    const list = await o.get('/v1/customers').expect(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(lanId);
  });

  it('sửa hồ sơ: validate + audit chỉ tên trường', async () => {
    await as(cashierToken).patch(`/v1/customers/${dotId}`).send({ note: 'x' }).expect(403);
    const bad = await as(managerToken)
      .patch(`/v1/customers/${dotId}`)
      .send({ email: 'không-phải-email' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    await as(managerToken)
      .patch(`/v1/customers/${dotId}`)
      .send({ birthday: '2999-01-01' })
      .expect(400);

    const res = await as(managerToken)
      .patch(`/v1/customers/${dotId}`)
      .send({ email: 'Na@Example.com', tags: ['Quen', 'Quen', 'Sáng'], note: 'Bàn cửa sổ' })
      .expect(200);
    expect(res.body.data.email).toBe('n*@example.com');
    expect(res.body.data.tags).toEqual(['Quen', 'Sáng']);
    const [row] = await audits.find({ action: 'customer.update', entityId: dotId }).lean().exec();
    expect(row.metadata).toEqual({ fields: ['email', 'tags', 'note'] });
    expect(JSON.stringify(row)).not.toContain('example.com');
  });

  it('chỉ chủ quán được xoá dữ liệu cá nhân; ẩn danh hoá giữ thống kê và đơn', async () => {
    await as(managerToken).post(`/v1/customers/${lanId}/anonymize`).expect(403);

    const res = await as(owner.token).post(`/v1/customers/${lanId}/anonymize`).expect(200);
    const d = res.body.data;
    expect(d).toMatchObject({
      name: null,
      phone: null,
      email: null,
      birthday: null,
      tags: [],
      note: null,
      status: 'anonymous',
    });
    expect(d.anonymizedAt).toBeTruthy();
    expect(d.stats.visits).toBe(5);
    expect(d.stats.totalSpent.amount).toBe(1_250_000);
    expect(d.loyalty.points).toBe(1250);
    expect(d.recentOrders).toHaveLength(1);

    const raw = await customers.findOne({ id: lanId }).lean<CustomerDoc>().exec();
    expect(raw).toMatchObject({
      name: null,
      phone: null,
      email: null,
      birthday: null,
      userId: null,
      cookieAnchor: null,
      deletedAt: null,
    });
    expect(raw?.deviceFingerprints).toEqual([]);
    const order = await app
      .get<Model<OrderDoc>>(getModelToken(OrderDoc.name))
      .findOne({ customerId: lanId })
      .lean<OrderDoc>()
      .exec();
    expect(order?.customerSnapshot).toBeNull();

    const revealed = await as(owner.token).post(`/v1/customers/${lanId}/reveal`).expect(200);
    expect(revealed.body.data).toEqual({ name: null, phone: null, email: null, birthday: null });
    await as(owner.token).patch(`/v1/customers/${lanId}`).send({ name: 'Lan' }).expect(409);

    const audit = await audits
      .find({ action: 'customer.anonymize', entityId: lanId })
      .lean()
      .exec();
    expect(audit).toHaveLength(1);

    // Số điện thoại cũ giờ tìm không ra; khách vô danh mới vẫn tạo được (index partial)
    const search = await as(owner.token)
      .get('/v1/customers')
      .query({ q: '0901110001' })
      .expect(200);
    expect(search.body.data).toHaveLength(0);
    await app
      .get(CustomerRepository)
      .createAnonymous({ tenantId: owner.tenantId, cookieAnchor: newId() });
  });
});

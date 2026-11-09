import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { bootstrapApp, login, Owner, randomPhone, registerOwner } from './helpers';
import { MembershipRepository } from '../src/modules/tenant/repositories/membership.repository';
import type { RoleCode } from '../src/modules/tenant/schemas/membership.schema';
import { OrderDoc } from '../src/modules/order/schemas/order.schema';
import { PaymentDoc } from '../src/modules/payment/schemas/payment.schema';
import { AuditLogDoc } from '../src/modules/audit/audit.module';

/** Đọc body thô (Buffer) để kiểm tra BOM — superagent không tự parse text/csv. */
const binaryParser = ((
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}) as unknown as (res: request.Response, cb: (err: Error | null, body: unknown) => void) => void;

/**
 * Báo cáo bán hàng theo khoảng ngày + xuất CSV.
 * Dữ liệu được dời thời điểm trực tiếp trong DB để kiểm tra chia ngày theo giờ VN (UTC+7).
 */
describe('Reports (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Owner;
  let orderModel: Model<OrderDoc>;
  let paymentModel: Model<PaymentDoc>;
  let auditModel: Model<AuditLogDoc>;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${token}`),
  });

  const addStaff = async (roleCode: RoleCode, venueId: string | null, name: string) => {
    const phone = randomPhone();
    const reg = await http()
      .post('/v1/auth/register')
      .send({ phone, password: 'matkhau123', displayName: name })
      .expect(201);
    await app.get(MembershipRepository).create({
      tenantId: owner.tenantId,
      userId: reg.body.data.user.id,
      venueId,
      roleCode,
    });
    return { token: await login(app, phone), userId: reg.body.data.user.id as string };
  };

  /** Dời đơn + payment (và mốc hoàn tiền) về thời điểm cố định. */
  const moveTo = async (orderId: string, at: string) => {
    const when = new Date(at);
    await orderModel.updateOne({ id: orderId }, { $set: { createdAt: when } }).exec();
    await paymentModel
      .updateMany({ orderId }, { $set: { receivedAt: when, 'refunds.$[].refundedAt': when } })
      .exec();
  };

  const RANGE = 'from=2026-11-01&to=2026-11-02';

  beforeAll(async () => {
    app = await bootstrapApp('ordergo_e2e_reports');
    orderModel = app.get(getModelToken(OrderDoc.name));
    paymentModel = app.get(getModelToken(PaymentDoc.name));
    auditModel = app.get(getModelToken(AuditLogDoc.name));
    owner = await registerOwner(app, 'Trần Báo Cáo');
    const o = as(owner.token);

    const cat = await o
      .post('/v1/menu-categories')
      .send({ venueId: owner.venueId, name: 'Đồ uống' })
      .expect(201);
    const item = async (name: string, amount: number) =>
      (
        await o
          .post('/v1/menu-items')
          .send({
            venueId: owner.venueId,
            categoryId: cat.body.data.id,
            name,
            basePrice: { amount },
          })
          .expect(201)
      ).body.data.id as string;
    const coffee = await item('Cà phê, sữa', 30_000);
    const cake = await item('Bánh flan', 20_000);

    const order = async (lines: Array<{ menuItemId: string; quantity: number }>) =>
      (
        await o
          .post('/v1/orders')
          .send({ venueId: owner.venueId, orderType: 'takeaway', lines })
          .expect(201)
      ).body.data.id as string;

    // Đơn 1: 2 cà phê = 60.000, thu tiền mặt, hoàn 10.000 → 00:30 ngày 02/11 giờ VN
    const o1 = await order([{ menuItemId: coffee, quantity: 2 }]);
    const p1 = await o
      .post(`/v1/orders/${o1}/payments`)
      .send({ method: 'cash', amount: 60_000 })
      .expect(201);
    await o
      .post(`/v1/payments/${p1.body.data.payment.id}/refund`)
      .send({ amount: 10_000, reason: 'Khách trả lại' })
      .expect(201);
    await moveTo(o1, '2026-11-01T17:30:00Z');

    // Đơn 2: cà phê + bánh = 50.000, giảm 5.000 → 45.000 VietQR → 23:30 ngày 01/11 giờ VN
    const o2 = await order([
      { menuItemId: coffee, quantity: 1 },
      { menuItemId: cake, quantity: 1 },
    ]);
    await o.post(`/v1/orders/${o2}/discount`).send({ type: 'amount', value: 5_000 }).expect(201);
    await o
      .post(`/v1/orders/${o2}/payments`)
      .send({ method: 'vietqr', amount: 45_000 })
      .expect(201);
    await moveTo(o2, '2026-11-01T16:30:00Z');

    // Đơn 3: huỷ; Đơn 4: chưa thu (30.000) → 10:00 ngày 02/11 giờ VN
    const o3 = await order([{ menuItemId: cake, quantity: 1 }]);
    await o.post(`/v1/orders/${o3}/cancel`).send({ reason: 'test' }).expect(201);
    await moveTo(o3, '2026-11-02T03:00:00Z');
    const o4 = await order([{ menuItemId: coffee, quantity: 1 }]);
    await moveTo(o4, '2026-11-02T03:00:00Z');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('tổng hợp đúng và chia ngày/giờ theo giờ cơ sở', async () => {
    const res = await as(owner.token)
      .get(`/v1/reports/sales?venueId=${owner.venueId}&${RANGE}`)
      .expect(200);
    const r = res.body.data;
    expect(r.totals).toEqual({
      netRevenue: 95_000,
      collected: 105_000,
      refunds: 10_000,
      grossOrderValue: 135_000,
      orders: 3,
      cancelledOrders: 1,
      averageTicket: 45_000,
      discountTotal: 5_000,
      serviceChargeTotal: 0,
    });
    expect(r.daily).toEqual([
      { date: '2026-11-01', revenue: 45_000, orders: 1 },
      { date: '2026-11-02', revenue: 50_000, orders: 2 },
    ]);
    expect(r.byHour).toHaveLength(24);
    expect(r.byHour[23]).toEqual({ hour: 23, orders: 1, revenue: 45_000 });
    expect(r.byHour[0]).toEqual({ hour: 0, orders: 1, revenue: 50_000 });
    expect(r.byHour[10]).toEqual({ hour: 10, orders: 1, revenue: 0 });
    expect(r.byPaymentMethod).toEqual([
      { method: 'cash', amount: 50_000, refunded: 10_000, count: 1 },
      { method: 'vietqr', amount: 45_000, refunded: 0, count: 1 },
    ]);
    expect(r.topItems).toEqual([
      expect.objectContaining({ name: 'Cà phê, sữa', quantity: 3, revenue: 90_000 }),
      expect.objectContaining({ name: 'Bánh flan', quantity: 1, revenue: 20_000 }),
    ]);
    expect(r.byStaff).toEqual([
      {
        userId: owner.userId,
        displayName: 'Trần Báo Cáo',
        paymentsCount: 2,
        paymentsAmount: 105_000,
        ordersCreated: 3,
      },
    ]);
    expect(JSON.stringify(r)).not.toContain(owner.phone);
  });

  it('chỉ 1 ngày: 01/11 giờ VN chỉ có đơn 23:30', async () => {
    const res = await as(owner.token)
      .get(`/v1/reports/sales?venueId=${owner.venueId}&from=2026-11-01&to=2026-11-01`)
      .expect(200);
    expect(res.body.data.totals.netRevenue).toBe(45_000);
    expect(res.body.data.totals.orders).toBe(1);
    expect(res.body.data.daily).toHaveLength(1);
  });

  it('kiểm tra khoảng ngày', async () => {
    const o = as(owner.token);
    const big = await o.get('/v1/reports/sales?from=2026-01-01&to=2026-04-03').expect(400);
    expect(big.body.error.code).toBe('RANGE_TOO_LARGE');
    await o.get('/v1/reports/sales?from=2026-01-01&to=2026-04-02').expect(200); // đúng 92 ngày
    const inv = await o.get('/v1/reports/sales?from=2026-11-05&to=2026-11-01').expect(400);
    expect(inv.body.error.code).toBe('INVALID_RANGE');
    const bad = await o.get('/v1/reports/sales?from=2026-02-30&to=2026-03-01').expect(400);
    expect(bad.body.error.code).toBe('INVALID_DATE');
    const fmt = await o.get(`/v1/reports/sales/export?${RANGE}&format=xlsx`).expect(400);
    expect(fmt.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('báo cáo cũ /reports/today và /reports/daily vẫn chạy', async () => {
    const o = as(owner.token);
    await o.get(`/v1/reports/today?venueId=${owner.venueId}`).expect(200);
    const d = await o.get(`/v1/reports/daily?venueId=${owner.venueId}&date=2026-11-02`).expect(200);
    expect(d.body.data.date).toBe('2026-11-02');
  });

  it('xuất CSV: BOM, nội dung, dòng đóng dấu, audit', async () => {
    const res = await as(owner.token)
      .get(`/v1/reports/sales/export?venueId=${owner.venueId}&${RANGE}&format=csv`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="bao-cao-2026-11-01_2026-11-02.csv"',
    );
    const buf = res.body as Buffer;
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString('utf8').slice(1);
    expect(text).not.toMatch(/^\{"data"/);
    const lines = text.trimEnd().split('\r\n');
    expect(lines).toContain('Doanh thu thuần (VND),95000');
    expect(lines).toContain('2026-11-01,45000,1');
    expect(lines).toContain('Tiền mặt,50000,10000,1');
    expect(lines).toContain('"Cà phê, sữa",3,90000');
    expect(lines).toContain('Trần Báo Cáo,2,105000,3');
    expect(lines[lines.length - 1]).toMatch(
      /^Xuất bởi: Trần B\*\* C\*\* · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
    );
    expect(text).not.toContain(owner.phone);

    const audit = await auditModel
      .findOne({ tenantId: owner.tenantId, userId: owner.userId, action: 'report.export' })
      .lean()
      .exec();
    // 9 chỉ số + 2 ngày + 2 phương thức + 2 món + 1 nhân viên
    expect(audit?.metadata).toEqual({ from: '2026-11-01', to: '2026-11-02', rows: 16 });
  });

  it('quản lý xem được báo cáo nhưng không được xuất (thiếu report.export)', async () => {
    const m = await addStaff('venue_manager', owner.venueId, 'Lê Quản Lý');
    const mm = as(m.token);
    await mm.get(`/v1/reports/sales?venueId=${owner.venueId}&${RANGE}`).expect(200);
    const res = await mm
      .get(`/v1/reports/sales/export?venueId=${owner.venueId}&${RANGE}&format=csv`)
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const s = await addStaff('server', owner.venueId, 'Phục Vụ');
    await as(s.token).get(`/v1/reports/sales?${RANGE}`).expect(403);
  });

  it('giới hạn 20 lần xuất / giờ / người → 429 EXPORT_LIMIT (chặn trước khi dựng)', async () => {
    const acc = await addStaff('accountant', null, 'Kế Toán');
    const now = Date.now();
    await auditModel.insertMany(
      Array.from({ length: 20 }, (_, i) => ({
        id: `seed-export-${i}`,
        tenantId: owner.tenantId,
        userId: acc.userId,
        action: 'report.export',
        entityType: 'sales_report',
        entityId: owner.venueId,
        metadata: {},
        timestamp: new Date(now - i * 60_000),
      })),
    );
    const res = await as(acc.token)
      .get(`/v1/reports/sales/export?venueId=${owner.venueId}&${RANGE}`)
      .expect(429);
    expect(res.body.error.code).toBe('EXPORT_LIMIT');
    expect(
      await auditModel.countDocuments({ userId: acc.userId, action: 'report.export' }).exec(),
    ).toBe(20);
    // Người khác (owner) không bị ảnh hưởng
    await as(owner.token).get(`/v1/reports/sales/export?venueId=${owner.venueId}&${RANGE}`);
  });

  it('cô lập tenant', async () => {
    const other = await registerOwner(app, 'Chủ Khác');
    const x = as(other.token);
    const own = await x.get(`/v1/reports/sales?venueId=${other.venueId}&${RANGE}`).expect(200);
    expect(own.body.data.totals.netRevenue).toBe(0);
    expect(own.body.data.totals.orders).toBe(0);
    expect(own.body.data.byStaff).toEqual([]);
    const all = await x.get(`/v1/reports/sales?${RANGE}`).expect(200);
    expect(all.body.data.totals.collected).toBe(0);
    // Truy cập venue của tenant khác → không thấy
    const cross = await x.get(`/v1/reports/sales?venueId=${owner.venueId}&${RANGE}`).expect(404);
    expect(cross.body.error.code).toBe('NOT_FOUND');
    await x.get(`/v1/reports/sales/export?venueId=${owner.venueId}&${RANGE}`).expect(404);
    await x.get(`/v1/reports/sales?${RANGE}`).set('X-Tenant-Id', owner.tenantId).expect(403);
  });
});

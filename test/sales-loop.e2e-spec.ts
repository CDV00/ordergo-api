import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { bootstrapApp, login, Owner, randomPhone, registerOwner } from './helpers';
import { MembershipRepository } from '../src/modules/tenant/repositories/membership.repository';

/**
 * Vòng một ca bán hàng (Phase 1): bàn → gọi món → gọi thêm → bếp → huỷ món →
 * giảm giá → VietQR → thu tiền → bàn cần dọn → báo cáo.
 */
describe('Sales loop (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Owner;
  let serverToken: string;
  let tableA: string;
  let tableB: string;
  let coffeeId: string;
  let cakeId: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => http().delete(url).set('Authorization', `Bearer ${token}`),
  });

  beforeAll(async () => {
    app = await bootstrapApp('ordergo_e2e_sales');
    owner = await registerOwner(app, 'Sales');
    const o = as(owner.token);

    const cat = await o
      .post('/v1/menu-categories')
      .send({ venueId: owner.venueId, name: 'Cà phê' })
      .expect(201);
    coffeeId = (
      await o
        .post('/v1/menu-items')
        .send({
          venueId: owner.venueId,
          categoryId: cat.body.data.id,
          name: 'Cà phê sữa',
          basePrice: { amount: 30_000 },
        })
        .expect(201)
    ).body.data.id;
    cakeId = (
      await o
        .post('/v1/menu-items')
        .send({
          venueId: owner.venueId,
          categoryId: cat.body.data.id,
          name: 'Bánh flan',
          basePrice: { amount: 20_000 },
        })
        .expect(201)
    ).body.data.id;

    tableA = (await o.post('/v1/tables').send({ venueId: owner.venueId, name: 'A1' }).expect(201))
      .body.data.id;
    tableB = (await o.post('/v1/tables').send({ venueId: owner.venueId, name: 'A2' }).expect(201))
      .body.data.id;

    // Nhân viên phục vụ (chưa có API mời → tạo membership trực tiếp)
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
    serverToken = await login(app, phone);
  });

  afterAll(async () => {
    await app?.close();
  });

  const tableStatus = async (id: string) => {
    const res = await as(owner.token).get('/v1/tables').expect(200);
    return (res.body.data as Array<{ id: string; status: string }>).find((t) => t.id === id)
      ?.status;
  };

  it('một ca bán hàng trọn vẹn', async () => {
    const s = as(serverToken);
    const o = as(owner.token);

    // 1. Phục vụ tạo đơn cho bàn A1 → bàn có khách
    const created = await s
      .post('/v1/orders')
      .send({
        venueId: owner.venueId,
        orderType: 'dine_in',
        tableId: tableA,
        lines: [{ menuItemId: coffeeId, quantity: 2 }],
      })
      .expect(201);
    const orderId: string = created.body.data.id;
    expect(created.body.data.pricing.total.amount).toBe(60_000);
    expect(await tableStatus(tableA)).toBe('occupied');

    // 2. Gửi bếp
    const sent = await s.post(`/v1/orders/${orderId}/send-to-kitchen`).expect(201);
    expect(sent.body.data.status).toBe('sent');
    const coffeeLine = sent.body.data.lines[0].id;

    // 3. Khách gọi thêm bánh → món mới chưa gửi bếp, tổng tăng
    const added = await s
      .post(`/v1/orders/${orderId}/lines`)
      .send({ lines: [{ menuItemId: cakeId, quantity: 1, note: 'ít ngọt' }] })
      .expect(201);
    expect(added.body.data.pricing.total.amount).toBe(80_000);
    const cakeLine = added.body.data.lines[1];
    expect(cakeLine.sentToKitchenAt).toBeNull();

    // Đổi số lượng món chưa gửi được; món đã gửi thì không
    await s.patch(`/v1/orders/${orderId}/lines/${cakeLine.id}`).send({ quantity: 2 }).expect(200);
    const locked = await s
      .patch(`/v1/orders/${orderId}/lines/${coffeeLine}`)
      .send({ quantity: 3 })
      .expect(400);
    expect(locked.body.error.code).toBe('LINE_ALREADY_SENT');

    // 4. Gửi bếp phần gọi thêm; không còn gì để gửi thì báo lỗi
    await s.post(`/v1/orders/${orderId}/send-to-kitchen`).expect(201);
    const nothing = await s.post(`/v1/orders/${orderId}/send-to-kitchen`).expect(400);
    expect(nothing.body.error.code).toBe('NOTHING_TO_SEND');

    // 5. Phục vụ không được huỷ món đã gửi bếp; chủ quán được
    const denied = await s
      .delete(`/v1/orders/${orderId}/lines/${cakeLine.id}`)
      .send({ reason: 'Khách đổi ý' })
      .expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    const removed = await o
      .delete(`/v1/orders/${orderId}/lines/${cakeLine.id}`)
      .send({ reason: 'Khách đổi ý' })
      .expect(200);
    expect(removed.body.data.pricing.total.amount).toBe(60_000);

    // 6. Bếp làm xong cà phê → đơn served
    await o
      .patch(`/v1/orders/${orderId}/lines/${coffeeLine}/kitchen-status`)
      .send({ status: 'served' })
      .expect(200);
    expect((await o.get(`/v1/orders/${orderId}`).expect(200)).body.data.status).toBe('served');

    // 7. Chuyển sang bàn A2 → A1 trống, A2 có khách
    await s.post(`/v1/orders/${orderId}/move-table`).send({ tableId: tableB }).expect(201);
    expect(await tableStatus(tableA)).toBe('available');
    expect(await tableStatus(tableB)).toBe('occupied');

    // 8. Giảm 10% (phục vụ không có quyền thu tiền/giảm giá)
    await s.post(`/v1/orders/${orderId}/discount`).send({ type: 'percent', value: 10 }).expect(403);
    const disc = await o
      .post(`/v1/orders/${orderId}/discount`)
      .send({ type: 'percent', value: 10, reason: 'Khách quen' })
      .expect(201);
    expect(disc.body.data.pricing.total.amount).toBe(54_000);

    // 9. VietQR: chưa có tài khoản → lỗi rõ ràng; cấu hình xong → QR đúng số tiền còn lại
    const noBank = await o.get(`/v1/orders/${orderId}/payment-qr`).expect(400);
    expect(noBank.body.error.code).toBe('NO_BANK_ACCOUNT');
    await o
      .patch(`/v1/venues/${owner.venueId}`)
      .send({
        bankAccount: { bankBin: '970436', accountNumber: '0123456789', accountName: 'QUAN SALES' },
        serviceChargeRate: 0,
      })
      .expect(200);

    // Thu trước 20.000 tiền mặt (khách đưa 50.000) → QR chỉ còn 34.000
    const cash = await o
      .post(`/v1/orders/${orderId}/payments`)
      .send({ method: 'cash', amount: 20_000, tenderedAmount: 50_000 })
      .expect(201);
    expect(cash.body.data.payment.tenderedAmount).toBe(50_000);
    const qr = await o.get(`/v1/orders/${orderId}/payment-qr`).expect(200);
    expect(qr.body.data.amount).toBe(34_000);
    expect(qr.body.data.bank.name).toBe('Vietcombank');
    expect(qr.body.data.qrPayload).toContain('540534000');

    // 10. Thu nốt bằng VietQR → đơn paid, bàn cần dọn, không sửa đơn được nữa
    const paid = await o
      .post(`/v1/orders/${orderId}/payments`)
      .send({ method: 'vietqr', amount: 34_000 })
      .expect(201);
    expect(paid.body.data.order.status).toBe('paid');
    expect(await tableStatus(tableB)).toBe('cleaning');
    const closed = await s
      .post(`/v1/orders/${orderId}/lines`)
      .send({ lines: [{ menuItemId: coffeeId, quantity: 1 }] })
      .expect(400);
    expect(closed.body.error.code).toBe('ORDER_CLOSED');

    // 11. Danh sách thanh toán hôm nay + báo cáo
    const payments = await o.get(`/v1/payments?venueId=${owner.venueId}`).expect(200);
    expect(payments.body.data).toHaveLength(2);
    const report = await o.get(`/v1/reports/today?venueId=${owner.venueId}`).expect(200);
    expect(report.body.data.revenue.net).toBe(54_000);
    expect(report.body.data.topItems[0]).toMatchObject({ name: 'Cà phê sữa', quantity: 2 });
  });

  it('huỷ đơn trả bàn về trống', async () => {
    const o = as(owner.token);
    const created = await o
      .post('/v1/orders')
      .send({
        venueId: owner.venueId,
        orderType: 'dine_in',
        tableId: tableA,
        lines: [{ menuItemId: coffeeId, quantity: 1 }],
      })
      .expect(201);
    expect(await tableStatus(tableA)).toBe('occupied');
    await o.post(`/v1/orders/${created.body.data.id}/cancel`).send({ reason: 'test' }).expect(201);
    expect(await tableStatus(tableA)).toBe('available');
  });

  it('thu ngân gọi món + gửi bếp + thu tiền được (bán tại quầy)', async () => {
    const phone = randomPhone();
    const reg = await http()
      .post('/v1/auth/register')
      .send({ phone, password: 'matkhau123', displayName: 'Thu ngân' })
      .expect(201);
    await app.get(MembershipRepository).create({
      tenantId: owner.tenantId,
      userId: reg.body.data.user.id,
      venueId: owner.venueId,
      roleCode: 'cashier',
    });
    const c = as(await login(app, phone));
    const created = await c
      .post('/v1/orders')
      .send({
        venueId: owner.venueId,
        orderType: 'takeaway',
        lines: [{ menuItemId: cakeId, quantity: 1 }],
      })
      .expect(201);
    await c.post(`/v1/orders/${created.body.data.id}/send-to-kitchen`).expect(201);
    await c
      .post(`/v1/orders/${created.body.data.id}/payments`)
      .send({ method: 'cash', amount: 20_000 })
      .expect(201);
  });

  it('quản lý (venue_manager) tạo đơn và thu tiền được nhờ order.manage', async () => {
    const phone = randomPhone();
    const reg = await http()
      .post('/v1/auth/register')
      .send({ phone, password: 'matkhau123', displayName: 'Quản lý' })
      .expect(201);
    await app.get(MembershipRepository).create({
      tenantId: owner.tenantId,
      userId: reg.body.data.user.id,
      venueId: owner.venueId,
      roleCode: 'venue_manager',
    });
    const m = as(await login(app, phone));
    const created = await m
      .post('/v1/orders')
      .send({
        venueId: owner.venueId,
        orderType: 'takeaway',
        lines: [{ menuItemId: cakeId, quantity: 1 }],
      })
      .expect(201);
    await m
      .post(`/v1/orders/${created.body.data.id}/payments`)
      .send({ method: 'cash', amount: 20_000 })
      .expect(201);
  });
});

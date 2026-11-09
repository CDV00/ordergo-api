import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { bootstrapApp, login, Owner, randomPhone, registerOwner } from './helpers';
import { MembershipRepository } from '../src/modules/tenant/repositories/membership.repository';

/** Ca làm: mở ca → thu tiền trong ca → đóng ca đối soát tiền mặt. */
describe('Shifts (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Owner;
  let other: Owner;
  let cashierToken: string;
  let cashierId: string;
  let serverToken: string;
  let coffeeId: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`),
  });

  const addStaff = async (roleCode: 'cashier' | 'server', name: string) => {
    const phone = randomPhone();
    const reg = await http()
      .post('/v1/auth/register')
      .send({ phone, password: 'matkhau123', displayName: name })
      .expect(201);
    await app.get(MembershipRepository).create({
      tenantId: owner.tenantId,
      userId: reg.body.data.user.id,
      venueId: owner.venueId,
      roleCode,
    });
    return { token: await login(app, phone), userId: reg.body.data.user.id as string };
  };

  /** Tạo đơn mang đi 1 món, trả về id + tổng tiền. */
  const newOrder = async (token: string, quantity = 1) => {
    const res = await as(token)
      .post('/v1/orders')
      .send({
        venueId: owner.venueId,
        orderType: 'takeaway',
        lines: [{ menuItemId: coffeeId, quantity }],
      })
      .expect(201);
    return { id: res.body.data.id as string, total: res.body.data.pricing.total.amount as number };
  };

  beforeAll(async () => {
    app = await bootstrapApp('ordergo_e2e_shift');
    owner = await registerOwner(app, 'Shift');
    other = await registerOwner(app, 'Khác');
    const o = as(owner.token);
    await http()
      .patch(`/v1/venues/${owner.venueId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ serviceChargeRate: 0 })
      .expect(200);
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

    const cashier = await addStaff('cashier', 'Thu ngân Lan');
    cashierToken = cashier.token;
    cashierId = cashier.userId;
    serverToken = (await addStaff('server', 'Phục vụ')).token;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('thu tiền khi chưa mở ca vẫn được (không gắn ca)', async () => {
    const c = as(cashierToken);
    const current = await c.get(`/v1/shifts/current?venueId=${owner.venueId}`).expect(200);
    expect(current.body.data).toBeNull();

    const order = await newOrder(cashierToken);
    const paid = await c
      .post(`/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: order.total })
      .expect(201);
    expect(paid.body.data.payment.shiftId).toBeNull();
  });

  it('một ca trọn vẹn: mở → thu → hoàn → đóng có chênh lệch', async () => {
    const c = as(cashierToken);
    const s = as(serverToken);

    // Phục vụ không có quyền mở ca / xem ca
    await s.post('/v1/shifts/open').send({ venueId: owner.venueId, openingCash: 0 }).expect(403);
    await s.get(`/v1/shifts/current?venueId=${owner.venueId}`).expect(403);

    // Mở ca
    const opened = await c
      .post('/v1/shifts/open')
      .send({ venueId: owner.venueId, openingCash: 500_000 })
      .expect(201);
    const shiftId: string = opened.body.data.id;
    expect(opened.body.data).toMatchObject({
      status: 'open',
      openingCash: 500_000,
      openedBy: cashierId,
      openedByName: 'Thu ngân Lan',
      expectedCash: 500_000,
    });
    expect(opened.body.data.openedByPhone).toBeUndefined();

    // Mở ca lần 2 → 409
    const dup = await as(owner.token)
      .post('/v1/shifts/open')
      .send({ venueId: owner.venueId, openingCash: 0 })
      .expect(409);
    expect(dup.body.error.code).toBe('SHIFT_ALREADY_OPEN');

    // Tiền đầu ca âm → 400
    await c.post('/v1/shifts/open').send({ venueId: owner.venueId, openingCash: -1 }).expect(400);

    // Thu tiền mặt 2 đơn + 1 đơn QR → payment tự gắn ca đang mở
    const o1 = await newOrder(cashierToken, 2); // 60.000
    const cash1 = await c
      .post(`/v1/orders/${o1.id}/payments`)
      .send({ method: 'cash', amount: o1.total, tenderedAmount: 100_000 })
      .expect(201);
    expect(cash1.body.data.payment.shiftId).toBe(shiftId);
    const o2 = await newOrder(cashierToken, 1); // 30.000
    await c
      .post(`/v1/orders/${o2.id}/payments`)
      .send({ method: 'cash', amount: 10_000 })
      .expect(201);
    await c
      .post(`/v1/orders/${o2.id}/payments`)
      .send({ method: 'vietqr', amount: o2.total - 10_000 })
      .expect(201);

    // Chủ quán hoàn 5.000 tiền mặt của đơn 1
    await as(owner.token)
      .post(`/v1/payments/${cash1.body.data.payment.id}/refund`)
      .send({ amount: 5_000, reason: 'Thiếu topping' })
      .expect(201);

    // Ca hiện tại: tiền dự kiến = 500.000 + 70.000 − 5.000
    const live = await c.get(`/v1/shifts/current?venueId=${owner.venueId}`).expect(200);
    expect(live.body.data.id).toBe(shiftId);
    expect(live.body.data.expectedCash).toBe(565_000);
    expect(live.body.data.summary).toMatchObject({
      cashReceived: 70_000,
      cashRefunds: 5_000,
      paymentCount: 3,
      paidOrderCount: 2,
    });

    // Phục vụ không đóng được ca
    await s.post(`/v1/shifts/${shiftId}/close`).send({ countedCash: 565_000 }).expect(403);

    // Lệch tiền mà không ghi chú → 400
    const noNote = await c
      .post(`/v1/shifts/${shiftId}/close`)
      .send({ countedCash: 560_000 })
      .expect(400);
    expect(noNote.body.error.code).toBe('NOTE_REQUIRED_FOR_DIFFERENCE');

    // Đóng ca với ghi chú
    const closed = await c
      .post(`/v1/shifts/${shiftId}/close`)
      .send({ countedCash: 560_000, note: 'Thối nhầm 5.000' })
      .expect(201);
    expect(closed.body.data).toMatchObject({
      status: 'closed',
      closedBy: cashierId,
      closedByName: 'Thu ngân Lan',
      countedCash: 560_000,
      expectedCash: 565_000,
      difference: -5_000,
      note: 'Thối nhầm 5.000',
    });
    expect(closed.body.data.summary.byMethod).toEqual([
      { method: 'cash', count: 2, amount: 70_000 },
      { method: 'vietqr', count: 1, amount: 20_000 },
    ]);
    expect(closed.body.data.summary.totalReceived).toBe(90_000);

    // Đóng lại lần nữa → 409
    const again = await c
      .post(`/v1/shifts/${shiftId}/close`)
      .send({ countedCash: 565_000 })
      .expect(409);
    expect(again.body.error.code).toBe('SHIFT_NOT_OPEN');
    expect(
      (await c.get(`/v1/shifts/current?venueId=${owner.venueId}`).expect(200)).body.data,
    ).toBeNull();

    // Chi tiết ca: summary + danh sách payment
    const detail = await c.get(`/v1/shifts/${shiftId}`).expect(200);
    expect(detail.body.data.payments).toHaveLength(3);
    expect(detail.body.data.summary.cashRefunds).toBe(5_000);

    // Danh sách: thu ngân thấy ca của mình; chủ quán thấy tất cả
    const mine = await c.get(`/v1/shifts?venueId=${owner.venueId}`).expect(200);
    expect(mine.body.data.map((x: { id: string }) => x.id)).toEqual([shiftId]);
    const all = await as(owner.token).get(`/v1/shifts?venueId=${owner.venueId}`).expect(200);
    expect(all.body.data).toHaveLength(1);

    // Audit: chỉ số tiền, không có dữ liệu cá nhân
    const logs = await app
      .get<Connection>(getConnectionToken())
      .collection('audit_logs')
      .find({ tenantId: owner.tenantId, entityId: shiftId })
      .toArray();
    expect(logs.map((l) => l.action).sort()).toEqual(['shift.close', 'shift.open']);
    expect(logs.find((l) => l.action === 'shift.close')?.metadata).toEqual({
      openingCash: 500_000,
      countedCash: 560_000,
      expectedCash: 565_000,
      difference: -5_000,
    });
  });

  it('đóng ca khớp tiền không cần ghi chú; mở được ca mới sau khi đóng', async () => {
    const c = as(cashierToken);
    const opened = await c
      .post('/v1/shifts/open')
      .send({ venueId: owner.venueId, openingCash: 200_000, note: 'Ca chiều' })
      .expect(201);
    const closed = await c
      .post(`/v1/shifts/${opened.body.data.id}/close`)
      .send({ countedCash: 200_000 })
      .expect(201);
    expect(closed.body.data.difference).toBe(0);
    expect(closed.body.data.note).toBe('Ca chiều');
  });

  it('cách ly tenant: chủ quán khác không xem/đóng được ca', async () => {
    const opened = await as(cashierToken)
      .post('/v1/shifts/open')
      .send({ venueId: owner.venueId, openingCash: 0 })
      .expect(201);
    const id: string = opened.body.data.id;
    const x = as(other.token);
    await x.get(`/v1/shifts/${id}`).expect(404);
    await x.post(`/v1/shifts/${id}/close`).send({ countedCash: 0 }).expect(404);
    await x.post('/v1/shifts/open').send({ venueId: owner.venueId, openingCash: 0 }).expect(404);
    const list = await x.get('/v1/shifts').expect(200);
    expect(list.body.data).toHaveLength(0);
    // Đổi header sang tenant khác → 403
    await http()
      .get(`/v1/shifts/current?venueId=${owner.venueId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(403);
    await as(cashierToken).post(`/v1/shifts/${id}/close`).send({ countedCash: 0 }).expect(201);
  });
});

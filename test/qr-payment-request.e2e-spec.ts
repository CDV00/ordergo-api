import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { bootstrapApp, Owner, registerOwner } from './helpers';

/**
 * Khách gọi món qua QR rồi báo thanh toán ("Tôi đã chuyển khoản" / trả tại quầy) →
 * nhân viên thấy ở GET /payments/pending và xác nhận bằng POST /orders/:id/payments.
 */
describe('QR — khách báo thanh toán (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Owner;
  let other: Owner;
  let menuItem: string;
  let table: string;
  let table2: string;
  let slug: string;
  const http = () => request(app.getHttpServer());
  const staff = (token = owner.token) => ({ Authorization: `Bearer ${token}` });

  /** Quét QR + gọi 1 món → { sessionId, orderId } */
  async function guestOrder(quantity = 1, tableId = table) {
    const scan = await http().post(`/v1/public/qr/${slug}/${tableId}`).expect(201);
    const sessionId: string = scan.body.data.session.id;
    const order = await http()
      .post(`/v1/public/sessions/${sessionId}/orders`)
      .send({ lines: [{ menuItemId: menuItem, quantity }] })
      .expect(201);
    return { sessionId, orderId: order.body.data.id as string };
  }

  const pending = async (token = owner.token, venueId = owner.venueId) =>
    (await http().get(`/v1/payments/pending?venueId=${venueId}`).set(staff(token)).expect(200)).body
      .data as Array<{ orderId: string; amountDue: number; method: string }>;

  beforeAll(async () => {
    app = await bootstrapApp('ordergo_e2e_qr_payment');
    owner = await registerOwner(app, 'QR Pay');
    other = await registerOwner(app, 'Quán khác');
    const cat = await http()
      .post('/v1/menu-categories')
      .set(staff())
      .send({ venueId: owner.venueId, name: 'Món' })
      .expect(201);
    menuItem = (
      await http()
        .post('/v1/menu-items')
        .set(staff())
        .send({
          venueId: owner.venueId,
          categoryId: cat.body.data.id,
          name: 'Trà đào',
          basePrice: { amount: 45_000 },
        })
        .expect(201)
    ).body.data.id;
    table = (
      await http()
        .post('/v1/tables')
        .set(staff())
        .send({ venueId: owner.venueId, name: 'Q1' })
        .expect(201)
    ).body.data.id;
    table2 = (
      await http()
        .post('/v1/tables')
        .set(staff())
        .send({ venueId: owner.venueId, name: 'Q2' })
        .expect(201)
    ).body.data.id;
    slug = (await http().get('/v1/me').set(staff()).expect(200)).body.data.tenants[0].slug;
  });

  afterAll(async () => {
    await app.close();
  });

  it('khách báo đã chuyển khoản → nhân viên thấy ở "chờ xác nhận" → xác nhận → hết chờ, đơn paid', async () => {
    const { sessionId, orderId } = await guestOrder(2);
    expect(await pending()).toEqual([]);

    const req = await http()
      .post(`/v1/public/sessions/${sessionId}/orders/${orderId}/payment-request`)
      .send({ method: 'vietqr' })
      .expect(201);
    expect(req.body.data).toMatchObject({ orderId, method: 'vietqr', amount: 90_000 });

    const list = await pending();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      orderId,
      method: 'vietqr',
      amountDue: 90_000,
      tableName: 'Q1',
    });

    // Quán khác không thấy
    expect(await pending(other.token, other.venueId)).toEqual([]);

    await http()
      .post(`/v1/orders/${orderId}/payments`)
      .set(staff())
      .send({ method: 'vietqr', amount: 90_000 })
      .expect(201);

    expect(await pending()).toEqual([]);
    const order = await http().get(`/v1/orders/${orderId}`).set(staff()).expect(200);
    expect(order.body.data.status).toBe('paid');
    expect(order.body.data.paymentRequest).toBeNull();
    // Khoản thu nằm trong danh sách thanh toán như mọi khoản khác
    const payments = await http()
      .get(`/v1/payments?venueId=${owner.venueId}`)
      .set(staff())
      .expect(200);
    expect(payments.body.data.map((p: { orderId: string }) => p.orderId)).toContain(orderId);
  });

  it('khách muốn trả tại quầy; huỷ đơn thì tự hết chờ', async () => {
    const { sessionId, orderId } = await guestOrder();
    await http()
      .post(`/v1/public/sessions/${sessionId}/orders/${orderId}/payment-request`)
      .send({ method: 'cash' })
      .expect(201);
    expect((await pending()).map((p) => p.method)).toEqual(['cash']);

    await http()
      .post(`/v1/orders/${orderId}/cancel`)
      .set(staff())
      .send({ reason: 'Khách đổi ý' })
      .expect(201);
    expect(await pending()).toEqual([]);
  });

  it('không báo thanh toán được cho đơn của bàn/phiên khác, phương thức lạ hay đơn đã trả', async () => {
    const a = await guestOrder();
    const b = await guestOrder(1, table2);
    const cross = await http()
      .post(`/v1/public/sessions/${b.sessionId}/orders/${a.orderId}/payment-request`)
      .send({ method: 'vietqr' })
      .expect(400);
    expect(cross.body.error.code).toBe('ORDER_NOT_IN_SESSION');

    await http()
      .post(`/v1/public/sessions/${a.sessionId}/orders/${a.orderId}/payment-request`)
      .send({ method: 'momo' })
      .expect(400);

    await http()
      .post(`/v1/orders/${a.orderId}/payments`)
      .set(staff())
      .send({ method: 'cash', amount: 45_000 })
      .expect(201);
    const paid = await http()
      .post(`/v1/public/sessions/${a.sessionId}/orders/${a.orderId}/payment-request`)
      .send({ method: 'vietqr' })
      .expect(400);
    expect(paid.body.error.code).toBe('ORDER_NOT_PAYABLE');
  });
});

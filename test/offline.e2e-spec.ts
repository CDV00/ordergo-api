import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { bootstrapApp, Owner, registerOwner } from './helpers';

/**
 * POS offline: các thao tác ghi được gửi lại với cùng `Idempotency-Key` không bị chạy 2 lần.
 */
describe('Offline / Idempotency-Key (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Owner;
  let other: Owner;
  let coffeeId: string;
  let tableId: string;

  const http = () => request(app.getHttpServer());
  const as = (o: Owner) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${o.token}`),
    post: (url: string, key?: string) => {
      const r = http().post(url).set('Authorization', `Bearer ${o.token}`);
      return key ? r.set('Idempotency-Key', key) : r;
    },
  });

  beforeAll(async () => {
    app = await bootstrapApp('ordergo_e2e_offline');
    owner = await registerOwner(app, 'Offline');
    other = await registerOwner(app, 'Khác');
    const o = as(owner);
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
          name: 'Cà phê đen',
          basePrice: { amount: 25_000 },
        })
        .expect(201)
    ).body.data.id;
    tableId = (await o.post('/v1/tables').send({ venueId: owner.venueId, name: 'B1' }).expect(201))
      .body.data.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const orderBody = () => ({
    venueId: owner.venueId,
    orderType: 'dine_in',
    tableId,
    lines: [{ menuItemId: coffeeId, quantity: 2 }],
  });

  let orderId: string;

  it('gửi lại POST /orders cùng key → cùng đơn, chỉ 1 đơn được tạo, clientId = key', async () => {
    const key = randomUUID();
    const first = await as(owner).post('/v1/orders', key).send(orderBody()).expect(201);
    const again = await as(owner).post('/v1/orders', key).send(orderBody()).expect(201);

    orderId = first.body.data.id;
    expect(again.body.data.id).toBe(orderId);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(first.body.data.clientId).toBe(key);

    const list = await as(owner).get(`/v1/orders?tableId=${tableId}`).expect(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('gửi lại POST /orders/:id/lines cùng key → không nhân đôi món', async () => {
    const key = randomUUID();
    const add = { lines: [{ menuItemId: coffeeId, quantity: 1, note: 'ít đá' }] };
    await as(owner).post(`/v1/orders/${orderId}/lines`, key).send(add).expect(201);
    const again = await as(owner).post(`/v1/orders/${orderId}/lines`, key).send(add).expect(201);
    expect(again.body.data.lines).toHaveLength(2);

    const order = await as(owner).get(`/v1/orders/${orderId}`).expect(200);
    expect(order.body.data.lines).toHaveLength(2);
  });

  it('gửi lại send-to-kitchen cùng key → trả kết quả cũ thay vì NOTHING_TO_SEND', async () => {
    const key = randomUUID();
    const first = await as(owner).post(`/v1/orders/${orderId}/send-to-kitchen`, key).expect(201);
    const again = await as(owner).post(`/v1/orders/${orderId}/send-to-kitchen`, key).expect(201);
    expect(again.body.data.status).toBe(first.body.data.status);
    // Không có key → hành vi cũ
    const res = await as(owner).post(`/v1/orders/${orderId}/send-to-kitchen`).expect(400);
    expect(res.body.error.code).toBe('NOTHING_TO_SEND');
  });

  it('cùng key dùng cho path khác → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = randomUUID();
    await as(owner)
      .post(`/v1/orders/${orderId}/lines`, key)
      .send({ lines: [{ menuItemId: coffeeId, quantity: 1 }] })
      .expect(201);
    const res = await as(owner).post(`/v1/orders/${orderId}/send-to-kitchen`, key).expect(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('request lỗi không được lưu → sửa rồi gửi lại cùng key thì chạy thật', async () => {
    const key = randomUUID();
    const bad = await as(owner)
      .post('/v1/orders', key)
      .send({ ...orderBody(), tableId: undefined, orderType: 'takeaway', lines: [] })
      .expect(400);
    expect(bad.body.error.code).toBe('EMPTY_ORDER');
    const ok = await as(owner)
      .post('/v1/orders', key)
      .send({ ...orderBody(), tableId: undefined, orderType: 'takeaway' })
      .expect(201);
    expect(ok.headers['idempotent-replayed']).toBeUndefined();
  });

  it('key tách theo tenant: tenant khác dùng cùng key vẫn tạo đơn của mình', async () => {
    const key = randomUUID();
    const a = await as(owner)
      .post('/v1/orders', key)
      .send({ ...orderBody(), tableId: undefined, orderType: 'takeaway' })
      .expect(201);

    const cat = await as(other)
      .post('/v1/menu-categories')
      .send({ venueId: other.venueId, name: 'Trà' })
      .expect(201);
    const teaId = (
      await as(other)
        .post('/v1/menu-items')
        .send({
          venueId: other.venueId,
          categoryId: cat.body.data.id,
          name: 'Trà đá',
          basePrice: { amount: 5_000 },
        })
        .expect(201)
    ).body.data.id;
    const b = await as(other)
      .post('/v1/orders', key)
      .send({
        venueId: other.venueId,
        orderType: 'takeaway',
        lines: [{ menuItemId: teaId, quantity: 1 }],
      })
      .expect(201);

    expect(b.body.data.id).not.toBe(a.body.data.id);
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect(b.body.data.tenantId).toBe(other.tenantId);
  });

  it('gửi trùng song song → chỉ 1 đơn', async () => {
    const key = randomUUID();
    const body = { ...orderBody(), tableId: undefined, orderType: 'takeaway' };
    const results = await Promise.all([
      as(owner).post('/v1/orders', key).send(body),
      as(owner).post('/v1/orders', key).send(body),
      as(owner).post('/v1/orders', key).send(body),
    ]);
    const ok = results.filter((r) => r.status === 201);
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(new Set(ok.map((r) => r.body.data.id as string)).size).toBe(1);

    const list = await as(owner).get('/v1/orders').expect(200);
    const withKey = (list.body.data as Array<{ clientId: string | null }>).filter(
      (o) => o.clientId === key,
    );
    expect(withKey).toHaveLength(1);
  });

  it('key sai định dạng → 400 IDEMPOTENCY_KEY_INVALID', async () => {
    const res = await as(owner).post('/v1/orders', 'x').send(orderBody()).expect(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });
});

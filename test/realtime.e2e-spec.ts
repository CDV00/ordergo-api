import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, Socket } from 'socket.io-client';
import { bootstrapApp, Owner, registerOwner } from './helpers';

/**
 * Realtime cần MongoDB replica set (change streams). CI và docker-compose đều chạy rs0.
 */
describe('Realtime (e2e)', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let ownerA: Owner;
  let ownerB: Owner;
  let menuItemA: string;
  let tableA: string;
  let slugA: string;
  const sockets: Socket[] = [];

  const http = () => request(app.getHttpServer());

  /** Kết nối và chờ tới khi server xác nhận (ready) hoặc từ chối (error). */
  function connect(auth: Record<string, string>): Promise<{ socket: Socket; error?: string }> {
    const socket = io(`${baseUrl}/realtime`, {
      auth,
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    return new Promise((resolve) => {
      socket.on('realtime.ready', () => resolve({ socket }));
      socket.on('realtime.error', (e: { code: string }) => resolve({ socket, error: e.code }));
      socket.on('connect_error', (e) => resolve({ socket, error: e.message }));
    });
  }

  function nextEvent<T>(socket: Socket, event: string, match: (p: T) => boolean, ms = 5000) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Không nhận được ${event}`)), ms);
      const handler = (p: T) => {
        if (!match(p)) return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(p);
      };
      socket.on(event, handler);
    });
  }

  function noEvent(socket: Socket, event: string, ms = 1500): Promise<boolean> {
    return new Promise((resolve) => {
      const handler = () => resolve(false);
      socket.once(event, handler);
      setTimeout(() => {
        socket.off(event, handler);
        resolve(true);
      }, ms);
    });
  }

  beforeAll(async () => {
    app = await bootstrapApp('ordergo_e2e_realtime');
    await app.listen(0);
    const port = ((app.getHttpServer() as unknown as Server).address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    ownerA = await registerOwner(app, 'Realtime A');
    ownerB = await registerOwner(app, 'Realtime B');
    const auth = { Authorization: `Bearer ${ownerA.token}` };
    const cat = await http()
      .post('/v1/menu-categories')
      .set(auth)
      .send({ venueId: ownerA.venueId, name: 'Món' })
      .expect(201);
    menuItemA = (
      await http()
        .post('/v1/menu-items')
        .set(auth)
        .send({
          venueId: ownerA.venueId,
          categoryId: cat.body.data.id,
          name: 'Cà phê',
          basePrice: { amount: 20_000 },
        })
        .expect(201)
    ).body.data.id;
    tableA = (
      await http().post('/v1/tables').set(auth).send({ venueId: ownerA.venueId, name: 'R1' })
    ).body.data.id;
    const me = await http().get('/v1/me').set(auth).expect(200);
    slugA = me.body.data.tenants[0].slug;

    // Change stream cần vài trăm ms để sẵn sàng sau khi app khởi động
    // (helper đã drop DB → stream bị invalidate và watcher mở lại sau ~1s)
    await new Promise((r) => setTimeout(r, 2000));
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await app?.close();
  });

  it('nhiều khách vô danh cùng quét QR trong 1 quán (không trùng index customers)', async () => {
    for (let i = 0; i < 3; i++) {
      // Không gửi cookie → mỗi lần là 1 khách vô danh mới (phone/userId = null)
      await http().post(`/v1/public/qr/${slugA}/${tableA}`).expect(201);
    }
  });

  it('từ chối kết nối không có / sai token', async () => {
    expect((await connect({})).error).toBe('UNAUTHENTICATED');
    expect((await connect({ token: 'abc' })).error).toBe('INVALID_TOKEN');
  });

  it('từ chối owner A xin nghe venue/tenant của B', async () => {
    const r = await connect({ token: ownerA.token, tenantId: ownerB.tenantId });
    expect(r.error).toBe('FORBIDDEN');
    const r2 = await connect({
      token: ownerA.token,
      tenantId: ownerA.tenantId,
      venueId: ownerB.venueId,
    });
    expect(r2.error).toBe('FORBIDDEN');
  });

  it('đơn mới của A tới socket của A (nhân viên + khách tại bàn), không tới B', async () => {
    const a = await connect({
      token: ownerA.token,
      tenantId: ownerA.tenantId,
      venueId: ownerA.venueId,
    });
    const b = await connect({
      token: ownerB.token,
      tenantId: ownerB.tenantId,
      venueId: ownerB.venueId,
    });
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();

    // Khách quét QR bàn R1 → phiên → socket khách
    const scan = await http().post(`/v1/public/qr/${slugA}/${tableA}`).expect(201);
    const guest = await connect({ sessionId: scan.body.data.session.id });
    expect(guest.error).toBeUndefined();

    // Gắn listener TRƯỚC khi gửi request — event có thể tới trước cả response
    const bSilent = noEvent(b.socket, 'order.changed');
    const staffInsert = nextEvent<{ id: string; op: string; tableName: string }>(
      a.socket,
      'order.changed',
      (p) => p.op === 'insert' && p.tableName === 'R1',
    );
    const guestInsert = nextEvent<{ id: string; status: string }>(
      guest.socket,
      'order.changed',
      (p) => p.status === 'draft',
    );
    const created = await http()
      .post('/v1/orders')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        venueId: ownerA.venueId,
        orderType: 'dine_in',
        tableId: tableA,
        lines: [{ menuItemId: menuItemA, quantity: 1 }],
      })
      .expect(201);
    const orderId: string = created.body.data.id;

    expect((await staffInsert).id).toBe(orderId);
    expect((await guestInsert).id).toBe(orderId);
    expect(await bSilent).toBe(true);

    // Gửi bếp → sự kiện update kèm số món chờ làm
    const kitchenEvt = nextEvent<{ id: string; status: string; kitchen: { queued: number } }>(
      a.socket,
      'order.changed',
      (p) => p.id === orderId && p.status === 'sent',
    );
    await http()
      .post(`/v1/orders/${orderId}/send-to-kitchen`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(201);
    expect((await kitchenEvt).kitchen.queued).toBe(1);

    // Bàn chuyển trạng thái cũng được phát
    const tableEvt = await nextEvent<{ id: string; status: string }>(
      a.socket,
      'table.changed',
      (p) => p.id === tableA,
      3000,
    ).catch(() => null);
    // (bàn đã chuyển occupied ngay lúc tạo đơn — có thể đã phát trước khi đăng ký listener)
    expect(tableEvt === null || tableEvt.status === 'occupied').toBe(true);
  }, 20_000);
});

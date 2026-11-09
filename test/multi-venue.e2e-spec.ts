import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { bootstrapApp, login, Owner, randomPhone, registerOwner } from './helpers';
import { MembershipRepository } from '../src/modules/tenant/repositories/membership.repository';
import type { RoleCode } from '../src/modules/tenant/schemas/membership.schema';
import { VenueDoc } from '../src/modules/tenant/schemas/venue.schema';
import { AuditLogDoc } from '../src/modules/audit/audit.module';

interface MenuItemRes {
  id: string;
  venueId: string | null;
  categoryId: string;
  name: string;
  imageUrl: string | null;
  basePrice: { amount: number };
  variants: Array<{ id: string; name: string }>;
  toppingGroups: Array<{ id: string; options: Array<{ id: string }> }>;
}

/**
 * Chuỗi nhiều chi nhánh: tạo chi nhánh 2, sao chép menu, bán ở cả 2 nơi,
 * báo cáo gộp `venueId=all`, phân quyền quản lý gắn 1 cơ sở và cô lập tenant.
 */
describe('Multi-venue (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Owner;
  let venue2: string;
  let auditModel: Model<AuditLogDoc>;
  let venueModel: Model<VenueDoc>;

  const http = () => request(app.getHttpServer());
  const as = (token: string, venueId?: string) => {
    const h = (r: request.Test) => {
      r.set('Authorization', `Bearer ${token}`);
      if (venueId) r.set('X-Venue-Id', venueId);
      return r;
    };
    return {
      get: (url: string) => h(http().get(url)),
      post: (url: string) => h(http().post(url)),
      patch: (url: string) => h(http().patch(url)),
    };
  };

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
    return await login(app, phone);
  };

  const items = async (venueId: string) =>
    (await as(owner.token).get(`/v1/menu-items?venueId=${venueId}`).expect(200)).body
      .data as MenuItemRes[];

  /** Tạo + thu đủ tiền 1 đơn mang về ở cơ sở `venueId`; trả về tổng tiền. */
  const sell = async (venueId: string, menuItemId: string, quantity: number) => {
    const o = as(owner.token, venueId);
    const order = await o
      .post('/v1/orders')
      .send({ venueId, orderType: 'takeaway', lines: [{ menuItemId, quantity }] })
      .expect(201);
    const total = order.body.data.pricing.total.amount as number;
    await o
      .post(`/v1/orders/${order.body.data.id}/payments`)
      .send({ method: 'cash', amount: total })
      .expect(201);
    return total;
  };

  beforeAll(async () => {
    app = await bootstrapApp('ordergo_e2e_multi_venue');
    auditModel = app.get(getModelToken(AuditLogDoc.name));
    venueModel = app.get(getModelToken(VenueDoc.name));
    owner = await registerOwner(app, 'Chủ Chuỗi');
    const o = as(owner.token);

    // Menu cơ sở 1: 2 nhóm, 3 món (có biến thể + topping + ảnh), 1 món hết hàng
    const cat = async (name: string) =>
      (await o.post('/v1/menu-categories').send({ venueId: owner.venueId, name }).expect(201)).body
        .data.id as string;
    const drinks = await cat('Đồ uống');
    const cakes = await cat('Bánh');
    const coffee = await o
      .post('/v1/menu-items')
      .send({
        venueId: owner.venueId,
        categoryId: drinks,
        name: 'Cà phê sữa',
        basePrice: { amount: 30_000 },
        imageUrl: '/uploads/x/coffee.jpg',
        variants: [
          { name: 'Size M', priceModifier: { amount: 0 }, isDefault: true },
          { name: 'Size L', priceModifier: { amount: 6_000 } },
        ],
        toppingGroups: [
          {
            name: 'Topping',
            maxSelect: 2,
            options: [{ name: 'Trân châu', priceModifier: { amount: 8_000 } }],
          },
        ],
      })
      .expect(201);
    await o
      .post('/v1/menu-items')
      .send({
        venueId: owner.venueId,
        categoryId: drinks,
        name: 'Trà đào',
        basePrice: { amount: 40_000 },
      })
      .expect(201);
    const flan = await o
      .post('/v1/menu-items')
      .send({
        venueId: owner.venueId,
        categoryId: cakes,
        name: 'Bánh flan',
        basePrice: { amount: 20_000 },
      })
      .expect(201);
    await o
      .patch(`/v1/menu-items/${flan.body.data.id}/availability`)
      .send({ isAvailable: false, unavailableReason: 'Hết' })
      .expect(200);
    expect(coffee.body.data.variants).toHaveLength(2);

    // Món dùng chung toàn chuỗi (venueId=null) — không cần chép, hiện ở mọi cơ sở
    await o
      .post('/v1/menu-items')
      .send({ categoryId: drinks, name: 'Nước suối', basePrice: { amount: 10_000 } })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('owner tạo chi nhánh 2 (mã trùng → 409)', async () => {
    const o = as(owner.token);
    const res = await o
      .post('/v1/venues')
      .send({
        name: 'Chi nhánh Quận 1',
        code: 'q1',
        businessType: 'cafe',
        addressLine1: '1 Lê Lợi',
        city: 'TP. Hồ Chí Minh',
      })
      .expect(201);
    venue2 = res.body.data.id;
    expect(res.body.data).toMatchObject({
      code: 'Q1',
      status: 'active',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    const dup = await o
      .post('/v1/venues')
      .send({ name: 'Trùng mã', code: 'Q1', businessType: 'cafe' })
      .expect(409);
    expect(dup.body.error.code).toBe('VENUE_CODE_TAKEN');

    // Danh sách: cơ sở đầu tiên đứng trước
    const list = await o.get('/v1/venues').expect(200);
    expect(list.body.data.map((v: { id: string }) => v.id)).toEqual([owner.venueId, venue2]);
  });

  it('sao chép menu: id mới, giữ ảnh/biến thể/topping, không chép món dùng chung', async () => {
    const o = as(owner.token);
    // Cùng 1 cơ sở → 400
    const same = await o
      .post(`/v1/venues/${venue2}/copy-menu`)
      .send({ fromVenueId: venue2 })
      .expect(400);
    expect(same.body.error.code).toBe('SAME_VENUE');

    const res = await o
      .post(`/v1/venues/${venue2}/copy-menu`)
      .send({ fromVenueId: owner.venueId })
      .expect(201);
    expect(res.body.data).toEqual({ categories: 2, items: 3, replacedItems: 0 });

    const src = await items(owner.venueId);
    const dst = await items(venue2);
    // Món dùng chung hiện ở cả 2 cơ sở
    expect(src.map((i) => i.name)).toContain('Nước suối');
    expect(dst.map((i) => i.name)).toContain('Nước suối');
    const own = dst.filter((i) => i.venueId === venue2);
    expect(own.map((i) => i.name).sort()).toEqual(['Bánh flan', 'Cà phê sữa', 'Trà đào']);

    const srcCoffee = src.find((i) => i.name === 'Cà phê sữa')!;
    const dstCoffee = own.find((i) => i.name === 'Cà phê sữa')!;
    expect(dstCoffee.id).not.toBe(srcCoffee.id);
    expect(dstCoffee.categoryId).not.toBe(srcCoffee.categoryId);
    expect(dstCoffee.imageUrl).toBe('/uploads/x/coffee.jpg');
    expect(dstCoffee.variants.map((v) => v.name)).toEqual(['Size M', 'Size L']);
    expect(dstCoffee.variants[0].id).not.toBe(srcCoffee.variants[0].id);
    expect(dstCoffee.toppingGroups[0].options[0].id).not.toBe(
      srcCoffee.toppingGroups[0].options[0].id,
    );
    // Hết hàng là theo từng cơ sở → bản sao còn bán
    expect(own.find((i) => i.name === 'Bánh flan')).toMatchObject({ isAvailable: true });

    const cats = await o.get(`/v1/menu-categories?venueId=${venue2}`).expect(200);
    const ownCats = cats.body.data.filter((c: { venueId: string }) => c.venueId === venue2);
    expect(ownCats.map((c: { name: string }) => c.name)).toEqual(['Đồ uống', 'Bánh']);
    expect(dstCoffee.categoryId).toBe(ownCats[0].id);

    const audit = await auditModel
      .findOne({ tenantId: owner.tenantId, action: 'menu.copy' })
      .lean()
      .exec();
    expect(audit).toMatchObject({ entityType: 'venue', entityId: venue2 });
    expect(audit?.metadata).toEqual({ categories: 2, items: 3, replacedItems: 0 });
  });

  it('chép lần 2 → 409 MENU_NOT_EMPTY; replace → xoá mềm menu cũ rồi chép lại', async () => {
    const o = as(owner.token);
    const before = (await items(venue2)).filter((i) => i.venueId === venue2);
    const conflict = await o
      .post(`/v1/venues/${venue2}/copy-menu`)
      .send({ fromVenueId: owner.venueId })
      .expect(409);
    expect(conflict.body.error.code).toBe('MENU_NOT_EMPTY');

    const res = await o
      .post(`/v1/venues/${venue2}/copy-menu`)
      .send({ fromVenueId: owner.venueId, replace: true })
      .expect(201);
    expect(res.body.data).toEqual({ categories: 2, items: 3, replacedItems: 3 });

    const after = (await items(venue2)).filter((i) => i.venueId === venue2);
    expect(after).toHaveLength(3);
    const oldIds = new Set(before.map((i) => i.id));
    expect(after.some((i) => oldIds.has(i.id))).toBe(false);
    // Món cũ đã xoá mềm → 404
    await o.get(`/v1/menu-items/${before[0].id}`).expect(404);
    const cats = await o.get(`/v1/menu-categories?venueId=${venue2}`).expect(200);
    expect(cats.body.data.filter((c: { venueId: string }) => c.venueId === venue2)).toHaveLength(2);
  });

  it('bán ở cả 2 cơ sở → báo cáo venueId=all = tổng từng cơ sở + byVenue', async () => {
    const coffee1 = (await items(owner.venueId)).find((i) => i.name === 'Cà phê sữa')!;
    const tea2 = (await items(venue2)).find((i) => i.name === 'Trà đào' && i.venueId === venue2)!;
    const t1 =
      (await sell(owner.venueId, coffee1.id, 2)) + (await sell(owner.venueId, coffee1.id, 1));
    const t2 = await sell(venue2, tea2.id, 3);
    expect(t1).toBe(90_000);
    expect(t2).toBe(120_000);

    const o = as(owner.token, owner.venueId);
    const r1 = (await o.get(`/v1/reports/sales?venueId=${owner.venueId}`).expect(200)).body.data;
    const r2 = (await o.get(`/v1/reports/sales?venueId=${venue2}`).expect(200)).body.data;
    const all = (await o.get('/v1/reports/sales?venueId=all').expect(200)).body.data;

    expect(r1.totals.netRevenue).toBe(90_000);
    expect(r2.totals.netRevenue).toBe(120_000);
    expect(all.venueId).toBe('all');
    expect(all.totals.netRevenue).toBe(r1.totals.netRevenue + r2.totals.netRevenue);
    expect(all.totals.orders).toBe(r1.totals.orders + r2.totals.orders);
    expect(all.totals.grossOrderValue).toBe(210_000);
    expect(all.byVenue).toEqual([
      {
        venueId: venue2,
        venueName: 'Chi nhánh Quận 1',
        revenue: 120_000,
        orders: 1,
        averageTicket: 120_000,
      },
      {
        venueId: owner.venueId,
        venueName: 'Chi nhánh Chủ Chuỗi',
        revenue: 90_000,
        orders: 2,
        averageTicket: 45_000,
      },
    ]);
    // Báo cáo 1 cơ sở không có byVenue
    expect(r1.byVenue).toBeUndefined();

    // Tổng quan hôm nay toàn chuỗi
    const today = (await o.get('/v1/reports/today?venueId=all').expect(200)).body.data;
    expect(today.revenue.net).toBe(210_000);
    expect(
      today.byVenue.map((v: { venueId: string; revenue: number; orders: number }) => [
        v.venueId,
        v.revenue,
        v.orders,
      ]),
    ).toEqual([
      [venue2, 120_000, 1],
      [owner.venueId, 90_000, 2],
    ]);
  });

  it('không gọi được món của chi nhánh khác vào đơn', async () => {
    const coffee1 = (await items(owner.venueId)).find((i) => i.name === 'Cà phê sữa')!;
    const res = await as(owner.token, venue2)
      .post('/v1/orders')
      .send({
        venueId: venue2,
        orderType: 'takeaway',
        lines: [{ menuItemId: coffee1.id, quantity: 1 }],
      })
      .expect(404);
    expect(res.body.error.code).toBe('MENU_ITEM_NOT_FOUND');
  });

  it('xuất CSV toàn chuỗi có phần "Theo chi nhánh"', async () => {
    const res = await as(owner.token)
      .get('/v1/reports/sales/export?venueId=all&format=csv')
      .buffer(true)
      .parse((r, cb) => {
        let s = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (s += c));
        r.on('end', () => cb(null, s));
      })
      .expect(200);
    const lines = (res.body as string).split('\r\n');
    expect(lines).toContain('Cơ sở,Tất cả cơ sở');
    expect(lines).toContain('Theo chi nhánh');
    expect(lines).toContain('Chi nhánh Quận 1,120000,1,120000');
    const audit = await auditModel
      .findOne({ tenantId: owner.tenantId, action: 'report.export' })
      .lean()
      .exec();
    expect(audit?.entityId).toBeNull();
    expect(audit?.metadata).toMatchObject({ venues: 2 });
  });

  it('khác múi giờ → 400 MIXED_TIMEZONES', async () => {
    await venueModel.updateOne({ id: venue2 }, { $set: { timezone: 'Asia/Tokyo' } }).exec();
    try {
      const res = await as(owner.token).get('/v1/reports/sales?venueId=all').expect(400);
      expect(res.body.error.code).toBe('MIXED_TIMEZONES');
    } finally {
      await venueModel.updateOne({ id: venue2 }, { $set: { timezone: 'Asia/Ho_Chi_Minh' } }).exec();
    }
  });

  it('quản lý gắn 1 cơ sở: 403 với all / cơ sở khác / tạo chi nhánh / chép menu', async () => {
    const token = await addStaff('venue_manager', owner.venueId, 'Quản Lý Q3');
    const m = as(token, owner.venueId);
    await m.get(`/v1/reports/sales?venueId=${owner.venueId}`).expect(200);
    const all = await m.get('/v1/reports/sales?venueId=all').expect(403);
    expect(all.body.error.code).toBe('VENUE_ACCESS_DENIED');
    const today = await m.get('/v1/reports/today?venueId=all').expect(403);
    expect(today.body.error.code).toBe('VENUE_ACCESS_DENIED');
    const other = await m.get(`/v1/reports/sales?venueId=${venue2}`).expect(403);
    expect(other.body.error.code).toBe('VENUE_ACCESS_DENIED');
    await m.get(`/v1/reports/daily?venueId=${venue2}`).expect(403);

    const create = await m
      .post('/v1/venues')
      .send({ name: 'Lén mở', code: 'X1', businessType: 'cafe' })
      .expect(403);
    expect(create.body.error.code).toBe('VENUE_ACCESS_DENIED');
    await m.patch(`/v1/venues/${venue2}`).send({ name: 'Đổi tên' }).expect(403);
    await m.patch(`/v1/venues/${owner.venueId}`).send({ receiptFooter: 'Cảm ơn' }).expect(200);

    const copy = await m
      .post(`/v1/venues/${venue2}/copy-menu`)
      .send({ fromVenueId: owner.venueId, replace: true })
      .expect(403);
    expect(copy.body.error.code).toBe('VENUE_ACCESS_DENIED');

    // Thu ngân không có menu.manage
    const cashier = await addStaff('cashier', owner.venueId, 'Thu Ngân');
    await as(cashier, owner.venueId)
      .post(`/v1/venues/${owner.venueId}/copy-menu`)
      .send({ fromVenueId: venue2 })
      .expect(403);
  });

  it('kế toán toàn chuỗi xem được all', async () => {
    const token = await addStaff('accountant', null, 'Kế Toán');
    const res = await as(token).get('/v1/reports/sales?venueId=all').expect(200);
    expect(res.body.data.totals.netRevenue).toBe(210_000);
  });

  it('cô lập tenant: cơ sở của tenant khác → 404', async () => {
    const other = await registerOwner(app, 'Chủ Khác');
    const x = as(other.token);
    const copy = await x
      .post(`/v1/venues/${other.venueId}/copy-menu`)
      .send({ fromVenueId: owner.venueId })
      .expect(404);
    expect(copy.body.error.code).toBe('NOT_FOUND');
    await x.post(`/v1/venues/${venue2}/copy-menu`).send({ fromVenueId: other.venueId }).expect(404);
    await x.get(`/v1/reports/sales?venueId=${venue2}`).expect(404);
    await as(other.token, other.venueId).get(`/v1/reports/sales?venueId=${venue2}`).expect(404);
    // all của tenant khác chỉ thấy số liệu của chính họ
    const all = await x.get('/v1/reports/sales?venueId=all').expect(200);
    expect(all.body.data.totals.netRevenue).toBe(0);
    expect(all.body.data.byVenue).toEqual([
      expect.objectContaining({ venueId: other.venueId, revenue: 0 }),
    ]);
  });
});

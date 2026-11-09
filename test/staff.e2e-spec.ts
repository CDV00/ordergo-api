import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { bootstrapApp, Owner, randomPhone, registerOwner } from './helpers';

describe('Staff (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Owner;
  let other: Owner;
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${token}`),
  });

  async function loginWith(phone: string, password: string) {
    const res = await http().post('/v1/auth/login').send({ phone, password }).expect(201);
    return res.body.data.tokens.accessToken as string;
  }

  beforeAll(async () => {
    app = await bootstrapApp('ordergo_e2e_staff');
    owner = await registerOwner(app, 'Chủ');
    other = await registerOwner(app, 'Quán khác');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('mời → đăng nhập mật khẩu tạm → đổi mật khẩu; khoá có hiệu lực ngay', async () => {
    const o = as(owner.token);
    const phone = randomPhone();
    const inv = await o
      .post('/v1/staff/invite')
      .send({ phone, displayName: 'Lê Thu Ngân', roleCode: 'cashier', venueId: owner.venueId })
      .expect(201);
    const temp: string = inv.body.data.tempPassword;
    expect(temp).toHaveLength(10);
    expect(inv.body.data.staff.phone).toMatch(/\*{4}/); // đã che

    // Mời trùng → 409
    await o
      .post('/v1/staff/invite')
      .send({ phone, displayName: 'Trùng', roleCode: 'cashier', venueId: owner.venueId })
      .expect(409);

    let token = await loginWith(phone, temp);
    await as(token).get('/v1/orders').expect(200);
    await as(token)
      .post('/v1/auth/change-password')
      .send({ currentPassword: 'sai-mat-khau', newPassword: 'matkhaumoi1' })
      .expect(401);
    await as(token)
      .post('/v1/auth/change-password')
      .send({ currentPassword: temp, newPassword: 'matkhaumoi1' })
      .expect(201);
    await http().post('/v1/auth/login').send({ phone, password: temp }).expect(401);
    token = await loginWith(phone, 'matkhaumoi1');

    // Thu ngân không vào được màn nhân viên
    await as(token).get('/v1/staff').expect(403);

    // Khoá → request kế tiếp bị chặn; mở khoá → dùng lại được
    const id: string = inv.body.data.staff.membershipId;
    await o.post(`/v1/staff/${id}/revoke`).expect(201);
    const denied = await as(token).get('/v1/orders').expect(403);
    expect(denied.body.error.code).toBe('TENANT_ACCESS_DENIED');
    await o.post(`/v1/staff/${id}/restore`).expect(201);
    await as(token).get('/v1/orders').expect(200);
  });

  it('quản lý chỉ quản lý vai trò thấp hơn, trong cơ sở của mình', async () => {
    const o = as(owner.token);
    const mPhone = randomPhone();
    const mgr = await o
      .post('/v1/staff/invite')
      .send({
        phone: mPhone,
        displayName: 'Quản Lý',
        roleCode: 'venue_manager',
        venueId: owner.venueId,
      })
      .expect(201);
    const m = as(await loginWith(mPhone, mgr.body.data.tempPassword));

    await m
      .post('/v1/staff/invite')
      .send({
        phone: randomPhone(),
        displayName: 'QL 2',
        roleCode: 'venue_manager',
        venueId: owner.venueId,
      })
      .expect(403);
    const kitchen = await m
      .post('/v1/staff/invite')
      .send({
        phone: randomPhone(),
        displayName: 'Bếp',
        roleCode: 'kitchen',
        venueId: owner.venueId,
      })
      .expect(201);
    // Nâng bếp lên quản lý → 403
    await m
      .patch(`/v1/staff/${kitchen.body.data.staff.membershipId}`)
      .send({ roleCode: 'venue_manager' })
      .expect(403);
    await m
      .patch(`/v1/staff/${kitchen.body.data.staff.membershipId}`)
      .send({ roleCode: 'server' })
      .expect(200);

    // Quản lý gắn cơ sở không thấy owner (membership toàn tenant) và không động được tới owner
    type Row = { roleCode: string; canManage: boolean; membershipId: string };
    const list = await m.get('/v1/staff').expect(200);
    expect((list.body.data as Row[]).some((r) => r.roleCode === 'owner')).toBe(false);
    const ownerList = await o.get('/v1/staff').expect(200);
    const ownerRow = (ownerList.body.data as Row[]).find((r) => r.roleCode === 'owner')!;
    expect(ownerRow.canManage).toBe(false); // owner tự xem mình: không tự khoá được
    await m.post(`/v1/staff/${ownerRow.membershipId}/revoke`).expect(404);
    // Không tự khoá mình
    await m.post(`/v1/staff/${mgr.body.data.staff.membershipId}/revoke`).expect(400);

    // Không mời vào cơ sở của tenant khác
    await m
      .post('/v1/staff/invite')
      .send({
        phone: randomPhone(),
        displayName: 'Lạ',
        roleCode: 'kitchen',
        venueId: other.venueId,
      })
      .expect(403);
  });

  it('tenant khác không thấy / không sửa được nhân viên', async () => {
    const list = await as(owner.token).get('/v1/staff').expect(200);
    const anyId: string = list.body.data[1].membershipId;
    await as(other.token).post(`/v1/staff/${anyId}/revoke`).expect(404);
    const otherList = await as(other.token).get('/v1/staff').expect(200);
    expect(otherList.body.data).toHaveLength(1);
  });

  it('audit ghi thao tác nhân viên, không chứa SĐT', async () => {
    const db = app.get<Connection>(getConnectionToken());
    const rows = await db
      .collection('audit_logs')
      .find({ tenantId: owner.tenantId, action: { $regex: '^staff\\.' } })
      .toArray();
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['staff.invite', 'staff.revoke', 'staff.restore', 'staff.update']),
    );
    expect(JSON.stringify(rows)).not.toMatch(/\+84\d{9}/);
  });
});

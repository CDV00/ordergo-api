/**
 * Seed dữ liệu demo: chuỗi cà phê 2 chi nhánh — Quận 3 (đầy đủ menu, bàn, nhân viên, 7 ngày lịch sử)
 * và Quận 1 (menu chép từ Quận 3, bàn A1–A6, 3 ngày lịch sử, ít đơn hơn).
 *
 *   yarn seed:demo                 # build + reset + seed (chạy lại bao nhiêu lần cũng được)
 *   node dist/scripts/seed-demo.js # trong Docker image production (đã build sẵn)
 *
 * Reset chỉ xoá dữ liệu của tenant demo (tìm theo SĐT tài khoản demo), không đụng tenant khác.
 * Từ chối chạy khi NODE_ENV=production trừ khi thêm cờ --force.
 *
 * Biến môi trường tuỳ chọn:
 *   DEMO_PASSWORD       mật khẩu cho mọi tài khoản demo (mặc định: ordergo123)
 *   DEMO_BANK_BIN, DEMO_BANK_NAME, DEMO_BANK_ACCOUNT, DEMO_BANK_ACCOUNT_NAME
 *                       tài khoản nhận VietQR. Không đặt → bỏ trống (KHÔNG tự bịa số tài khoản:
 *                       khách quét QR có thể chuyển nhầm tiền cho người lạ).
 */
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { AppModule } from '../app.module';
import { TenantContextService } from '../common/context/tenant-context.service';
import { AuthService } from '../modules/identity/auth.service';
import { UserRepository } from '../modules/identity/repositories/user.repository';
import { TenantService } from '../modules/tenant/tenant.service';
import { MembershipRepository } from '../modules/tenant/repositories/membership.repository';
import { VenueRepository } from '../modules/tenant/repositories/venue.repository';
import type { RoleCode } from '../modules/tenant/schemas/membership.schema';
import { CatalogService } from '../modules/catalog/catalog.service';
import type { MenuItemDoc } from '../modules/catalog/schemas/menu-item.schema';
import { TableService } from '../modules/table/table.service';
import { TableDoc } from '../modules/table/schemas/table.schema';
import { OrderService } from '../modules/order/order.service';
import { OrderDoc } from '../modules/order/schemas/order.schema';
import { PaymentService } from '../modules/payment/payment.service';
import { PaymentDoc } from '../modules/payment/schemas/payment.schema';
import { CustomerDoc } from '../modules/customer/schemas/customer.schema';
import { newId } from '../shared/utils/uuid';

// ─── Cấu hình demo ─────────────────────────────────────────────────────────

const PASSWORD = process.env.DEMO_PASSWORD ?? 'ordergo123';
const HISTORY_DAYS = 7;
/** Chi nhánh 2: ít ngày lịch sử, lượng khách bằng ~nửa Quận 3. */
const BRANCH_HISTORY_DAYS = 3;
const BRANCH_TRAFFIC = 0.5;

const STAFF: Array<{ phone: string; name: string; role: RoleCode | 'owner' }> = [
  { phone: '0900000001', name: 'Nguyễn Minh Anh', role: 'owner' },
  { phone: '0900000002', name: 'Trần Quốc Bảo', role: 'venue_manager' },
  { phone: '0900000003', name: 'Lê Thu Hà', role: 'cashier' },
  { phone: '0900000004', name: 'Phạm Gia Huy', role: 'server' },
  { phone: '0900000005', name: 'Võ Thanh Tâm', role: 'kitchen' },
];

/**
 * Khách thành viên — dữ liệu TỔNG HỢP (không phải người thật, không gửi SMS/email cho ai).
 * `weight` = độ "ruột" khi gán vào đơn lịch sử.
 */
const DEMO_CUSTOMERS: Array<{ name: string; weight: number; birthday: string; tags?: string[] }> = [
  { name: 'Nguyễn Thị Mai', weight: 8, birthday: '1995-03-12', tags: ['khách quen'] },
  { name: 'Trần Văn Hùng', weight: 7, birthday: '1988-07-02', tags: ['khách quen'] },
  { name: 'Lê Hoàng Nam', weight: 6, birthday: '1999-11-20' },
  { name: 'Phạm Ngọc Anh', weight: 5, birthday: '2001-01-08', tags: ['sinh viên'] },
  { name: 'Hoàng Minh Tuấn', weight: 5, birthday: '1992-05-30' },
  { name: 'Vũ Thu Trang', weight: 4, birthday: '1997-09-14' },
  { name: 'Đặng Quốc Khánh', weight: 4, birthday: '1985-12-25', tags: ['văn phòng'] },
  { name: 'Bùi Thanh Hương', weight: 3, birthday: '1994-04-17' },
  { name: 'Đỗ Gia Bảo', weight: 3, birthday: '2003-08-09', tags: ['sinh viên'] },
  { name: 'Hồ Thị Lan', weight: 3, birthday: '1990-02-03' },
  { name: 'Ngô Đức Thịnh', weight: 2, birthday: '1987-06-21', tags: ['văn phòng'] },
  { name: 'Dương Mỹ Linh', weight: 2, birthday: '1998-10-11' },
  { name: 'Lý Văn Phúc', weight: 2, birthday: '1991-03-29' },
  { name: 'Mai Khánh Vy', weight: 2, birthday: '2000-12-01' },
  { name: 'Trịnh Công Sơn', weight: 1, birthday: '1983-07-15' },
  { name: 'Phan Bảo Ngọc', weight: 1, birthday: '1996-05-05' },
  { name: 'Tạ Minh Châu', weight: 1, birthday: '1993-09-27' },
  { name: 'Cao Thị Hạnh', weight: 1, birthday: '1989-01-19' },
];

const TABLE_SECTIONS: Array<{ section: string; prefix: string; count: number; capacity: number }> =
  [
    { section: 'Tầng trệt', prefix: 'T', count: 5, capacity: 4 },
    { section: 'Sân vườn', prefix: 'S', count: 4, capacity: 4 },
    { section: 'Lầu 1', prefix: 'L', count: 3, capacity: 6 },
  ];

type Kind = 'coffee' | 'tea' | 'juice' | 'blended' | 'food';
interface DemoItem {
  name: string;
  price: number;
  description?: string;
  tags?: string[];
  unavailable?: string;
  /** Độ phổ biến tương đối khi sinh đơn lịch sử. */
  weight?: number;
}

const MENU: Array<{ category: string; kind: Kind; items: DemoItem[] }> = [
  {
    category: 'Cà phê',
    kind: 'coffee',
    items: [
      { name: 'Cà phê đen đá', price: 25_000, weight: 8, tags: ['bán chạy'] },
      { name: 'Cà phê sữa đá', price: 29_000, weight: 10, tags: ['bán chạy'] },
      { name: 'Bạc xỉu', price: 32_000, weight: 7 },
      { name: 'Cà phê muối', price: 39_000, weight: 6, tags: ['mới'] },
      { name: 'Cold brew cam sả', price: 45_000, weight: 3 },
      { name: 'Americano', price: 35_000, weight: 3 },
      { name: 'Latte', price: 45_000, weight: 4 },
      { name: 'Cappuccino', price: 45_000, weight: 3 },
    ],
  },
  {
    category: 'Trà & Trà sữa',
    kind: 'tea',
    items: [
      { name: 'Trà đào cam sả', price: 45_000, weight: 8, tags: ['bán chạy'] },
      { name: 'Trà vải hoa hồng', price: 45_000, weight: 4 },
      { name: 'Trà sữa trân châu đường đen', price: 42_000, weight: 7 },
      { name: 'Trà sữa ô long', price: 39_000, weight: 4 },
      { name: 'Trà chanh giã tay', price: 25_000, weight: 5 },
      { name: 'Matcha latte', price: 49_000, weight: 3 },
    ],
  },
  {
    category: 'Nước ép & Sinh tố',
    kind: 'juice',
    items: [
      { name: 'Nước ép cam', price: 39_000, weight: 4 },
      { name: 'Nước ép dưa hấu', price: 35_000, weight: 3 },
      { name: 'Sinh tố xoài', price: 45_000, weight: 3 },
      { name: 'Sinh tố bơ', price: 49_000, weight: 3, unavailable: 'Hết bơ hôm nay' },
      { name: 'Nước dừa tươi', price: 30_000, weight: 3 },
    ],
  },
  {
    category: 'Đá xay',
    kind: 'blended',
    items: [
      { name: 'Cookie đá xay', price: 55_000, weight: 3 },
      { name: 'Matcha đá xay', price: 55_000, weight: 2 },
      { name: 'Chocolate đá xay', price: 52_000, weight: 2 },
      { name: 'Cà phê đá xay', price: 52_000, weight: 2 },
    ],
  },
  {
    category: 'Bánh & Ăn nhẹ',
    kind: 'food',
    items: [
      { name: 'Bánh mì que pate', price: 15_000, weight: 4 },
      { name: 'Croissant bơ', price: 35_000, weight: 3 },
      { name: 'Bánh tiramisu', price: 45_000, weight: 3 },
      { name: 'Bánh flan', price: 20_000, weight: 3 },
      { name: 'Khoai tây chiên', price: 35_000, weight: 3 },
      { name: 'Hạt hướng dương', price: 20_000, weight: 2 },
      { name: 'Bánh croffle kem', price: 49_000, weight: 2, tags: ['mới'] },
    ],
  },
];

/** Số đơn trung bình theo giờ (quán mở 7h–22h): cao điểm sáng, trưa, tối. */
const HOURLY_ORDERS: Record<number, number> = {
  7: 4,
  8: 5,
  9: 3,
  10: 2,
  11: 3,
  12: 4,
  13: 3,
  14: 2,
  15: 2,
  16: 2,
  17: 2,
  18: 3,
  19: 5,
  20: 4,
  21: 2,
};

// ─── Tiện ích ──────────────────────────────────────────────────────────────

/** PRNG có seed (mulberry32) → dữ liệu demo giống nhau mỗi lần chạy. */
function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(arr: T[]) => arr[Math.floor(next() * arr.length)],
    weighted: <T>(arr: T[], weightOf: (x: T) => number) => {
      const total = arr.reduce((s, x) => s + weightOf(x), 0);
      let r = next() * total;
      for (const x of arr) {
        r -= weightOf(x);
        if (r <= 0) return x;
      }
      return arr[arr.length - 1];
    },
  };
}

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function minutesLater(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

function variantsFor(kind: Kind, price: number) {
  if (kind === 'food') return [];
  const upsize = price >= 45_000 ? 8_000 : 6_000;
  return [
    { name: 'Size M', priceModifier: { amount: 0 }, isDefault: true },
    { name: 'Size L', priceModifier: { amount: upsize } },
  ];
}

function toppingGroupsFor(kind: Kind) {
  const sugar = {
    name: 'Mức đường',
    minSelect: 0,
    maxSelect: 1,
    options: ['100% đường', '70% đường', '50% đường', 'Không đường'].map((name) => ({
      name,
      priceModifier: { amount: 0 },
    })),
  };
  const ice = {
    name: 'Mức đá',
    minSelect: 0,
    maxSelect: 1,
    options: ['Đá bình thường', 'Ít đá', 'Không đá'].map((name) => ({
      name,
      priceModifier: { amount: 0 },
    })),
  };
  const toppings = {
    name: 'Topping',
    minSelect: 0,
    maxSelect: 3,
    options: [
      { name: 'Trân châu đen', priceModifier: { amount: 8_000 } },
      { name: 'Thạch đào', priceModifier: { amount: 8_000 } },
      { name: 'Kem cheese', priceModifier: { amount: 12_000 } },
    ],
  };
  switch (kind) {
    case 'coffee':
      return [sugar, ice];
    case 'tea':
      return [sugar, ice, toppings];
    case 'juice':
    case 'blended':
      return [sugar];
    default:
      return [];
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('NODE_ENV=production — thêm --force nếu thật sự muốn seed dữ liệu demo.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const rng = createRng(20261109);

  const connection = app.get<Connection>(getConnectionToken());
  const orderModel = app.get<Model<OrderDoc>>(getModelToken(OrderDoc.name));
  const paymentModel = app.get<Model<PaymentDoc>>(getModelToken(PaymentDoc.name));
  const tableModel = app.get<Model<TableDoc>>(getModelToken(TableDoc.name));
  const customerModel = app.get<Model<CustomerDoc>>(getModelToken(CustomerDoc.name));
  const tenantCtx = app.get(TenantContextService);
  const auth = app.get(AuthService);
  const users = app.get(UserRepository);
  const tenantService = app.get(TenantService);
  const memberships = app.get(MembershipRepository);
  const venues = app.get(VenueRepository);
  const catalog = app.get(CatalogService);
  const tables = app.get(TableService);
  const orders = app.get(OrderService);
  const payments = app.get(PaymentService);

  // ── 1. Reset dữ liệu demo cũ ──
  const db = connection.db!;
  const phones = STAFF.map((s) => '+84' + s.phone.substring(1));
  const oldUsers = await db
    .collection('users')
    .find({ phone: { $in: phones } })
    .project<{ id: string }>({ id: 1 })
    .toArray();
  const oldUserIds = oldUsers.map((u) => u.id);
  if (oldUserIds.length > 0) {
    const oldTenants = await db
      .collection('tenants')
      .find({ ownerUserId: { $in: oldUserIds } })
      .project<{ id: string }>({ id: 1 })
      .toArray();
    const oldTenantIds = oldTenants.map((t) => t.id);
    let removed = 0;
    for (const c of await db.collections()) {
      if (oldTenantIds.length > 0) {
        removed += (await c.deleteMany({ tenantId: { $in: oldTenantIds } })).deletedCount;
      }
    }
    await db.collection('tenants').deleteMany({ id: { $in: oldTenantIds } });
    await db.collection('refresh_tokens').deleteMany({ userId: { $in: oldUserIds } });
    await db.collection('users').deleteMany({ id: { $in: oldUserIds } });
    console.log(`🧹 Đã xoá demo cũ: ${oldTenantIds.length} tenant, ${removed} bản ghi.`);
  }

  // ── 2. Tài khoản + doanh nghiệp ──
  const staffIds = new Map<string, string>();
  for (const s of STAFF) {
    await auth.register({ phone: s.phone, password: PASSWORD, displayName: s.name });
    const u = await users.findByPhone('+84' + s.phone.substring(1));
    staffIds.set(s.phone, u!.id);
  }
  const ownerId = staffIds.get(STAFF[0].phone)!;
  const { tenant, venue } = await tenantService.setupWizard(ownerId, {
    tenantName: 'Cà phê Góc Phố',
    venueName: 'Góc Phố - Quận 3',
    venueCode: 'Q3',
    businessType: 'cafe',
    address: '123 Võ Văn Tần, Phường 6',
    city: 'TP. Hồ Chí Minh',
  });
  for (const s of STAFF.slice(1)) {
    await memberships.create({
      tenantId: tenant.id,
      userId: staffIds.get(s.phone)!,
      venueId: venue.id,
      roleCode: s.role,
      invitedBy: ownerId,
      status: 'active',
    });
  }

  const ctx = { userId: ownerId, tenantId: tenant.id, venueId: venue.id, permissions: ['*'] };
  await tenantCtx.run(ctx, async () => {
    // ── 3. Tài khoản VietQR (chỉ khi có env) ──
    if (process.env.DEMO_BANK_BIN && process.env.DEMO_BANK_ACCOUNT) {
      await venues.updateById(venue.id, {
        $set: {
          'settings.bankAccount': {
            bankBin: process.env.DEMO_BANK_BIN,
            bankName: process.env.DEMO_BANK_NAME ?? null,
            accountNumber: process.env.DEMO_BANK_ACCOUNT,
            accountName: process.env.DEMO_BANK_ACCOUNT_NAME ?? null,
          },
        },
      });
    }

    // ── 4. Menu ──
    const menuItems: Array<{ doc: MenuItemDoc; weight: number }> = [];
    for (const [ci, group] of MENU.entries()) {
      const category = await catalog.createCategory({
        venueId: venue.id,
        name: group.category,
        displayOrder: ci,
      });
      for (const [ii, item] of group.items.entries()) {
        let doc = await catalog.createItem({
          venueId: venue.id,
          categoryId: category.id,
          name: item.name,
          description: item.description,
          basePrice: { amount: item.price },
          displayOrder: ii,
          variants: variantsFor(group.kind, item.price),
          toppingGroups: toppingGroupsFor(group.kind),
          tags: item.tags,
        });
        if (item.unavailable) {
          doc = await catalog.toggleAvailability(doc.id, {
            isAvailable: false,
            unavailableReason: item.unavailable,
          });
        }
        menuItems.push({ doc, weight: item.weight ?? 1 });
      }
    }
    const sellable = menuItems.filter((m) => m.doc.isAvailable);

    // ── 5. Bàn ──
    const allTables: TableDoc[] = [];
    for (const s of TABLE_SECTIONS) {
      for (let i = 1; i <= s.count; i++) {
        allTables.push(
          await tables.create({
            venueId: venue.id,
            section: s.section,
            name: `${s.prefix}${i}`,
            capacity: s.capacity,
          }),
        );
      }
    }

    const randomLines = () =>
      Array.from({ length: rng.int(1, 4) }, () => {
        const { doc } = rng.weighted(sellable, (m) => m.weight);
        const variant = doc.variants.length > 0 && rng.chance(0.3) ? doc.variants[1] : null;
        const toppingOptionIds = doc.toppingGroups
          .filter(() => rng.chance(0.35))
          .map((g) => rng.pick(g.options).id);
        return {
          menuItemId: doc.id,
          variantId: variant?.id,
          toppingOptionIds,
          quantity: rng.chance(0.2) ? 2 : 1,
        };
      });

    // ── 5b. Khách thành viên (đã xác thực SĐT) ──
    const now0 = new Date();
    const customers = await customerModel.insertMany(
      DEMO_CUSTOMERS.map((c, i) => ({
        id: newId(),
        tenantId: tenant.id,
        status: 'verified',
        userId: null,
        cookieAnchor: null,
        // SĐT tổng hợp, đầu số 0389xxxxxx — chỉ để hiển thị (đã che) trên giao diện demo
        phone: `+84389${String(100000 + i * 7919).slice(-6)}`,
        name: c.name,
        email: null,
        birthday: new Date(`${c.birthday}T00:00:00Z`),
        deviceFingerprints: [],
        stats: {
          totalSpent: { amount: 0, currency: 'VND' },
          orderCount: 0,
          firstOrderAt: null,
          lastOrderAt: null,
        },
        tags: c.tags ?? [],
        consents: {
          marketing: { granted: false, grantedAt: null },
          crossTenantShare: { granted: false, grantedAt: null },
          privacyPolicyAcceptedAt: now0,
        },
        dataErasureRequestedAt: null,
        schemaVersion: 1,
        createdAt: now0,
        updatedAt: now0,
        deletedAt: null,
      })),
    );
    const pickCustomer = () =>
      rng.chance(0.35)
        ? customers[DEMO_CUSTOMERS.indexOf(rng.weighted(DEMO_CUSTOMERS, (c) => c.weight))].id
        : undefined;

    // ── 6. Lịch sử 7 ngày (không gồm hôm nay) ──
    let historyCount = 0;
    const today = new Date();
    for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
      const day = new Date(today);
      day.setDate(day.getDate() - daysAgo);
      const weekend = day.getDay() === 0 || day.getDay() === 6;
      let seq = 0;
      for (const [hourStr, base] of Object.entries(HOURLY_ORDERS)) {
        const count = Math.max(0, Math.round(base * (weekend ? 1.4 : 1) + rng.int(-1, 1)));
        for (let n = 0; n < count; n++) {
          const createdAt = new Date(day);
          createdAt.setHours(Number(hourStr), rng.int(0, 59), rng.int(0, 59), 0);
          const dineIn = rng.chance(0.65);
          const order = await orders.createDraft({
            venueId: venue.id,
            orderType: dineIn ? 'dine_in' : 'takeaway',
            tableId: dineIn ? rng.pick(allTables).id : undefined,
            // Thanh toán đơn có khách → tự cộng điểm thẻ thành viên (LoyaltyService)
            customerId: pickCustomer(),
            lines: randomLines(),
          });
          seq++;
          const orderNumber = `ORD-${ymd(day)}-${String(seq).padStart(4, '0')}`;
          const sentAt = minutesLater(createdAt, 1);
          const readyAt = minutesLater(createdAt, rng.int(4, 12));
          const servedAt = minutesLater(readyAt, rng.int(1, 3));

          if (rng.chance(0.03)) {
            await orders.cancel(order.id, { reason: 'Khách đổi ý' });
            await orderModel.updateOne(
              { id: order.id },
              { $set: { orderNumber, createdAt, updatedAt: createdAt, cancelledAt: createdAt } },
            );
            historyCount++;
            continue;
          }

          const paidAt = minutesLater(servedAt, rng.int(10, 60));
          await payments.createForOrder(order.id, {
            method: rng.chance(0.55) ? 'cash' : 'vietqr',
            amount: order.pricing.total.amount,
          });
          await orderModel.updateOne(
            { id: order.id },
            {
              $set: {
                orderNumber,
                createdAt,
                updatedAt: paidAt,
                sentAt,
                paidAt,
                lines: order.lines.map((l) => ({
                  ...l,
                  kitchenStatus: 'served',
                  sentToKitchenAt: sentAt,
                  readyAt,
                  servedAt,
                })),
              },
            },
          );
          await paymentModel.updateMany(
            { orderId: order.id },
            { $set: { orderNumber, receivedAt: paidAt, createdAt: paidAt, updatedAt: paidAt } },
          );
          historyCount++;
        }
      }
    }

    // ── 7. Hôm nay: đơn đã thu buổi sáng + vài bàn đang phục vụ ──
    const now = new Date();
    let todayPaid = 0;
    for (let h = 7; h < Math.min(now.getHours(), 22); h++) {
      const count = Math.max(0, (HOURLY_ORDERS[h] ?? 0) + rng.int(-1, 0));
      for (let n = 0; n < count; n++) {
        const order = await orders.createDraft({
          venueId: venue.id,
          orderType: 'takeaway',
          lines: randomLines(),
        });
        await orders.sendToKitchen(order.id);
        for (const line of order.lines) {
          await orders.setLineKitchenStatus(order.id, line.id, 'served');
        }
        await payments.createForOrder(order.id, {
          method: rng.chance(0.55) ? 'cash' : 'vietqr',
          amount: order.pricing.total.amount,
        });
        const createdAt = new Date(now);
        createdAt.setHours(h, rng.int(0, 59), 0, 0);
        await orderModel.updateOne(
          { id: order.id },
          { $set: { createdAt, paidAt: minutesLater(createdAt, 20) } },
        );
        todayPaid++;
      }
    }

    // Thống kê khách (tổng chi, số đơn, lần đầu/cuối) tính từ đơn đã thu
    const stats = await orderModel.aggregate<{
      _id: string;
      total: number;
      count: number;
      first: Date;
      last: Date;
    }>([
      { $match: { tenantId: tenant.id, customerId: { $ne: null }, status: 'paid' } },
      {
        $group: {
          _id: '$customerId',
          total: { $sum: '$pricing.total.amount' },
          count: { $sum: 1 },
          first: { $min: '$createdAt' },
          last: { $max: '$createdAt' },
        },
      },
    ]);
    for (const st of stats) {
      await customerModel.updateOne(
        { id: st._id },
        {
          $set: {
            'stats.totalSpent': { amount: st.total, currency: 'VND' },
            'stats.orderCount': st.count,
            'stats.firstOrderAt': st.first,
            'stats.lastOrderAt': st.last,
          },
        },
      );
    }

    // Đơn lịch sử đã thu → bàn bị chuyển "cần dọn"; dọn sạch trước khi dựng bàn đang phục vụ.
    await tableModel.updateMany(
      { tenantId: tenant.id },
      { $set: { status: 'available', currentOrderId: null, occupiedSince: null } },
    );

    // Bàn đang có khách: T1 vừa gọi (chờ bếp), T3 bếp đang làm, S2 món đã xong, L1 đơn nháp.
    const byName = (name: string) => allTables.find((t) => t.name === name)!;
    const live = [
      { table: 'T1', lines: 2, kitchen: null },
      { table: 'T3', lines: 3, kitchen: 'preparing' },
      { table: 'S2', lines: 2, kitchen: 'ready' },
      { table: 'L1', lines: 3, kitchen: 'draft' },
    ] as const;
    for (const l of live) {
      const t = byName(l.table);
      const order = await orders.createDraft({
        venueId: venue.id,
        orderType: 'dine_in',
        tableId: t.id,
        lines: randomLines().slice(0, l.lines),
      });
      if (l.kitchen !== 'draft') {
        await orders.sendToKitchen(order.id);
        if (l.kitchen) {
          for (const line of order.lines) {
            await orders.setLineKitchenStatus(order.id, line.id, l.kitchen);
          }
        }
      }
    }
    // Khách bàn T5 tự gọi món qua QR (đơn gửi thẳng xuống bếp như luồng QR thật)
    const qrOrder = await orders.createDraft({
      venueId: venue.id,
      orderType: 'dine_in',
      tableId: byName('T5').id,
      lines: randomLines().slice(0, 2),
    });
    await orderModel.updateOne({ id: qrOrder.id }, { $set: { source: 'qr_menu' } });
    await orders.sendToKitchen(qrOrder.id);

    await tables.changeStatus(byName('T2').id, { status: 'cleaning' });
    await tables.changeStatus(byName('L3').id, { status: 'reserved' });

    // ── 8. Chi nhánh 2 "Góc Phố - Quận 1" (sau cùng + RNG riêng → dữ liệu Quận 3 không đổi) ──
    const branch = await seedBranch();

    console.log(`📦 Menu: ${MENU.length} nhóm, ${menuItems.length} món`);
    console.log(`🪑 Bàn: ${allTables.length}`);
    console.log(
      `🧾 Đơn lịch sử ${HISTORY_DAYS} ngày: ${historyCount}, hôm nay đã thu: ${todayPaid}`,
    );
    console.log(`🔥 Đang phục vụ: ${live.map((l) => l.table).join(', ')}, T5 (khách gọi qua QR)`);
    console.log(`👥 Khách thành viên: ${customers.length} (dữ liệu tổng hợp)`);
    console.log(
      `🏬 Chi nhánh ${branch.name}: ${branch.items} món (chép từ Quận 3), ${branch.tables} bàn, ` +
        `${branch.history} đơn ${BRANCH_HISTORY_DAYS} ngày, hôm nay đã thu: ${branch.today}`,
    );

    async function seedBranch() {
      const brng = createRng(20261110);
      const q1 = await tenantService.createVenue({
        name: 'Góc Phố - Quận 1',
        code: 'Q1',
        businessType: 'cafe',
        addressLine1: '45 Lê Thánh Tôn, Phường Bến Nghé',
        city: 'TP. Hồ Chí Minh',
      });
      const copied = await catalog.copyMenu(q1.id, { fromVenueId: venue.id });
      // Giữ đúng tình trạng "hết món" như Quận 3 để demo giống nhau
      const q1Items = (await catalog.listItems({ venueId: q1.id })).filter(
        (i) => i.venueId === q1.id,
      );
      for (const group of MENU) {
        for (const item of group.items) {
          const doc = q1Items.find((i) => i.name === item.name);
          if (doc && item.unavailable) {
            await catalog.toggleAvailability(doc.id, {
              isAvailable: false,
              unavailableReason: item.unavailable,
            });
          }
        }
      }
      const weightOf = new Map(MENU.flatMap((g) => g.items.map((i) => [i.name, i.weight ?? 1])));
      const q1Sellable = q1Items.filter(
        (i) => !MENU.some((g) => g.items.some((x) => x.name === i.name && x.unavailable)),
      );
      const q1Lines = () =>
        Array.from({ length: brng.int(1, 3) }, () => {
          const doc = brng.weighted(q1Sellable, (i) => weightOf.get(i.name) ?? 1);
          const variant = doc.variants.length > 0 && brng.chance(0.3) ? doc.variants[1] : null;
          return { menuItemId: doc.id, variantId: variant?.id, quantity: 1 };
        });

      const q1Tables: TableDoc[] = [];
      for (let i = 1; i <= 6; i++) {
        q1Tables.push(
          await tables.create({ venueId: q1.id, section: 'Tầng trệt', name: `A${i}`, capacity: 4 }),
        );
      }

      let history = 0;
      for (let daysAgo = BRANCH_HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
        const day = new Date();
        day.setDate(day.getDate() - daysAgo);
        let seq = 0;
        for (const [hourStr, base] of Object.entries(HOURLY_ORDERS)) {
          const count = Math.max(0, Math.round(base * BRANCH_TRAFFIC + brng.int(-1, 1)));
          for (let n = 0; n < count; n++) {
            const createdAt = new Date(day);
            createdAt.setHours(Number(hourStr), brng.int(0, 59), brng.int(0, 59), 0);
            const dineIn = brng.chance(0.5);
            const order = await orders.createDraft({
              venueId: q1.id,
              orderType: dineIn ? 'dine_in' : 'takeaway',
              tableId: dineIn ? brng.pick(q1Tables).id : undefined,
              lines: q1Lines(),
            });
            seq++;
            const orderNumber = `ORD-${ymd(day)}-${String(seq).padStart(4, '0')}`;
            const sentAt = minutesLater(createdAt, 1);
            const readyAt = minutesLater(createdAt, brng.int(4, 12));
            const servedAt = minutesLater(readyAt, brng.int(1, 3));
            const paidAt = minutesLater(servedAt, brng.int(10, 45));
            await payments.createForOrder(order.id, {
              method: brng.chance(0.5) ? 'cash' : 'vietqr',
              amount: order.pricing.total.amount,
            });
            await orderModel.updateOne(
              { id: order.id },
              {
                $set: {
                  orderNumber,
                  createdAt,
                  updatedAt: paidAt,
                  sentAt,
                  paidAt,
                  lines: order.lines.map((l) => ({
                    ...l,
                    kitchenStatus: 'served',
                    sentToKitchenAt: sentAt,
                    readyAt,
                    servedAt,
                  })),
                },
              },
            );
            await paymentModel.updateMany(
              { orderId: order.id },
              { $set: { orderNumber, receivedAt: paidAt, createdAt: paidAt, updatedAt: paidAt } },
            );
            history++;
          }
        }
      }

      // Hôm nay: vài đơn mang về đã thu (để "Chi nhánh hôm nay" trên tổng quan có số liệu)
      let todayCount = 0;
      const nowB = new Date();
      for (let h = 7; h < Math.min(nowB.getHours(), 22); h += 2) {
        const order = await orders.createDraft({
          venueId: q1.id,
          orderType: 'takeaway',
          lines: q1Lines(),
        });
        await orders.sendToKitchen(order.id);
        for (const line of order.lines) {
          await orders.setLineKitchenStatus(order.id, line.id, 'served');
        }
        await payments.createForOrder(order.id, {
          method: brng.chance(0.5) ? 'cash' : 'vietqr',
          amount: order.pricing.total.amount,
        });
        const createdAt = new Date(nowB);
        createdAt.setHours(h, brng.int(0, 59), 0, 0);
        await orderModel.updateOne(
          { id: order.id },
          { $set: { createdAt, paidAt: minutesLater(createdAt, 20) } },
        );
        todayCount++;
      }

      // Đơn đã thu → bàn "cần dọn"; chi nhánh 2 không có bàn đang phục vụ
      await tableModel.updateMany(
        { tenantId: tenant.id, venueId: q1.id },
        { $set: { status: 'available', currentOrderId: null, occupiedSince: null } },
      );
      return {
        name: q1.name,
        items: copied.items,
        tables: q1Tables.length,
        history,
        today: todayCount,
      };
    }
  });

  console.log('\n✅ Seed demo xong — "Cà phê Góc Phố" (2 chi nhánh: Q3, Q1)');
  console.log(`   Tenant slug: ${tenant.slug}`);
  console.log(
    `   Mật khẩu chung: ${PASSWORD === 'ordergo123' ? 'ordergo123 (mặc định)' : '(DEMO_PASSWORD)'}`,
  );
  for (const s of STAFF) console.log(`   ${s.phone}  ${s.role.padEnd(13)} ${s.name}`);
  if (!process.env.DEMO_BANK_ACCOUNT) {
    console.log('   ⚠️  Chưa có tài khoản VietQR — đặt DEMO_BANK_* để bật thanh toán QR.');
  }

  await app.close();
}

main().catch((err) => {
  console.error('Seed thất bại:', err);
  process.exit(1);
});

import { computePricing, deriveOrderStatus } from './order-pricing';
import type { OrderDoc } from './schemas/order.schema';

type Line = OrderDoc['lines'][number];

function line(over: Partial<Line> & { total: number }): Line {
  const { total, ...rest } = over;
  return {
    id: Math.random().toString(36).slice(2),
    productType: 'menu_item',
    productId: 'p',
    productSnapshot: { name: 'Món', sku: null, imageUrl: null },
    variantId: null,
    variantSnapshot: null,
    modifiers: [],
    quantity: 1,
    unitPrice: { amount: total, currency: 'VND' },
    lineSubtotal: { amount: total, currency: 'VND' },
    discount: { amount: 0, currency: 'VND' },
    lineTotal: { amount: total, currency: 'VND' },
    note: null,
    kitchenStatus: 'queued',
    sentToKitchenAt: null,
    readyAt: null,
    servedAt: null,
    ...rest,
  };
}

const SENT = new Date('2026-11-10T08:00:00');

describe('computePricing', () => {
  it('cộng món chưa huỷ, bỏ món đã huỷ', () => {
    const p = computePricing(
      [line({ total: 30_000 }), line({ total: 20_000, kitchenStatus: 'cancelled' })],
      null,
      0,
    );
    expect(p.subtotal.amount).toBe(30_000);
    expect(p.total.amount).toBe(30_000);
  });

  it('giảm giá % rồi mới tính phí phục vụ', () => {
    const p = computePricing(
      [line({ total: 100_000 })],
      { type: 'percent', value: 10, reason: null },
      0.05,
    );
    expect(p.discount.amount).toBe(10_000);
    expect(p.serviceCharge.amount).toBe(4_500);
    expect(p.total.amount).toBe(94_500);
  });

  it('giảm giá số tiền không vượt subtotal', () => {
    const p = computePricing(
      [line({ total: 25_000 })],
      { type: 'amount', value: 50_000, reason: null },
      0,
    );
    expect(p.discount.amount).toBe(25_000);
    expect(p.total.amount).toBe(0);
  });

  it('chặn % ngoài khoảng 0–100', () => {
    const p = computePricing(
      [line({ total: 40_000 })],
      { type: 'percent', value: 150, reason: null },
      0,
    );
    expect(p.discount.amount).toBe(40_000);
  });
});

describe('deriveOrderStatus', () => {
  it('chưa gửi món nào → draft', () => {
    expect(deriveOrderStatus([line({ total: 1 })], 'draft')).toBe('draft');
  });

  it('món mới thêm vào đơn đã phục vụ xong → giữ served cho tới khi gửi bếp', () => {
    const lines = [
      line({ total: 1, sentToKitchenAt: SENT, kitchenStatus: 'served' }),
      line({ total: 1 }),
    ];
    expect(deriveOrderStatus(lines, 'served')).toBe('served');
  });

  it('gửi bếp thêm món khi đơn đã served → quay lại sent', () => {
    const lines = [
      line({ total: 1, sentToKitchenAt: SENT, kitchenStatus: 'served' }),
      line({ total: 1, sentToKitchenAt: SENT, kitchenStatus: 'queued' }),
    ];
    expect(deriveOrderStatus(lines, 'served')).toBe('sent');
  });

  it('có món đang làm → in_progress; tất cả xong → ready', () => {
    const preparing = [
      line({ total: 1, sentToKitchenAt: SENT, kitchenStatus: 'preparing' }),
      line({ total: 1, sentToKitchenAt: SENT, kitchenStatus: 'queued' }),
    ];
    expect(deriveOrderStatus(preparing, 'sent')).toBe('in_progress');
    const ready = [
      line({ total: 1, sentToKitchenAt: SENT, kitchenStatus: 'ready' }),
      line({ total: 1, sentToKitchenAt: SENT, kitchenStatus: 'served' }),
    ];
    expect(deriveOrderStatus(ready, 'in_progress')).toBe('ready');
  });

  it('món huỷ không giữ đơn ở trạng thái bếp', () => {
    const lines = [
      line({ total: 1, sentToKitchenAt: SENT, kitchenStatus: 'served' }),
      line({ total: 1, sentToKitchenAt: SENT, kitchenStatus: 'cancelled' }),
    ];
    expect(deriveOrderStatus(lines, 'in_progress')).toBe('served');
  });

  it('không đụng đơn đã thu / đã huỷ', () => {
    expect(deriveOrderStatus([line({ total: 1 })], 'paid')).toBe('paid');
  });
});

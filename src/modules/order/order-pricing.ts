import type { OrderDoc, OrderStatus } from './schemas/order.schema';

type Line = OrderDoc['lines'][number];
type Money = { amount: number; currency: string };

export interface DiscountSpec {
  type: 'percent' | 'amount';
  /** percent: 0–100; amount: VND */
  value: number;
  reason: string | null;
}

const ZERO: Money = { amount: 0, currency: 'VND' };
const vnd = (amount: number): Money => ({ amount: Math.round(amount), currency: 'VND' });

/** Trạng thái đơn còn đang mở (chưa thu / chưa huỷ). */
export const OPEN_ORDER_STATUSES: OrderStatus[] = [
  'draft',
  'sent',
  'in_progress',
  'ready',
  'served',
];

/** Món tính tiền = chưa bị huỷ. */
export function billableLines(lines: Line[]): Line[] {
  return lines.filter((l) => l.kitchenStatus !== 'cancelled');
}

/**
 * Tính lại pricing của đơn.
 *  - subtotal  = tổng lineTotal các món chưa huỷ
 *  - discount  = theo spec, không vượt subtotal
 *  - service   = serviceChargeRate × (subtotal − discount)
 *  - tax       = 0 — giá menu đã gồm VAT (bill ghi "Giá đã bao gồm VAT")
 *  - total     = subtotal − discount + service
 */
export function computePricing(
  lines: Line[],
  discount: DiscountSpec | null,
  serviceChargeRate: number,
): OrderDoc['pricing'] {
  const subtotal = billableLines(lines).reduce((s, l) => s + l.lineTotal.amount, 0);

  let discountAmount = 0;
  if (discount) {
    discountAmount =
      discount.type === 'percent'
        ? Math.round((subtotal * Math.min(Math.max(discount.value, 0), 100)) / 100)
        : Math.round(Math.max(discount.value, 0));
  }
  discountAmount = Math.min(discountAmount, subtotal);

  const afterDiscount = subtotal - discountAmount;
  const service = Math.round(afterDiscount * Math.max(serviceChargeRate, 0));

  return {
    subtotal: vnd(subtotal),
    discount: vnd(discountAmount),
    serviceCharge: vnd(service),
    tax: { ...ZERO },
    total: vnd(afterDiscount + service),
  };
}

/**
 * Trạng thái đơn suy ra từ món (chỉ cho đơn còn mở).
 *  - Còn món chưa gửi bếp và chưa có món nào gửi  → draft
 *  - Tất cả món đã gửi đều served/cancelled       → served (trừ khi còn món chưa gửi → giữ trạng thái bếp)
 *  - Tất cả món đã gửi ready/served               → ready
 *  - Có món preparing                             → in_progress
 *  - Còn lại                                      → sent
 */
export function deriveOrderStatus(lines: Line[], current: OrderStatus): OrderStatus {
  if (!OPEN_ORDER_STATUSES.includes(current)) return current;

  const active = billableLines(lines);
  const sent = active.filter((l) => l.sentToKitchenAt !== null);
  if (sent.length === 0) return 'draft';

  const unsentExists = active.some((l) => l.sentToKitchenAt === null);
  const allServed = sent.every((l) => l.kitchenStatus === 'served');
  const allReady = sent.every((l) => l.kitchenStatus === 'ready' || l.kitchenStatus === 'served');
  const anyPreparing = sent.some((l) => l.kitchenStatus === 'preparing');

  if (allServed && !unsentExists) return 'served';
  if (allReady && !allServed) return 'ready';
  if (allServed && unsentExists) return 'served';
  if (anyPreparing) return 'in_progress';
  return 'sent';
}

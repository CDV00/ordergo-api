import type { PaymentMethod, PaymentStatus } from '../payment/schemas/payment.schema';
import type { ShiftSummary } from './schemas/shift.schema';

/** Phần tối thiểu của payment cần để tổng hợp ca. */
export interface SummaryPayment {
  orderId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: { amount: number };
  refunds: Array<{ amount: { amount: number }; refundedAt: Date }>;
}

/** Trạng thái payment được tính là đã thu tiền (hoàn tiền trừ riêng theo thời điểm hoàn). */
const RECEIVED_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  'succeeded',
  'partially_refunded',
  'refunded',
]);

/** Thứ tự hiển thị phương thức trong tổng hợp. */
const METHOD_ORDER: PaymentMethod[] = [
  'cash',
  'vietqr',
  'bank_transfer',
  'card',
  'momo',
  'vnpay',
  'zalopay',
];

/**
 * Tổng hợp ca:
 *  - `shiftPayments`: payment gắn với ca (`payment.shiftId === shift.id`).
 *  - `refundCandidates`: payment của cơ sở có hoàn tiền trong khoảng [from, to] (có thể thuộc ca khác) —
 *    hoàn tiền được tính vào ca đang diễn ra lúc hoàn.
 */
export function computeShiftSummary(
  shiftPayments: SummaryPayment[],
  refundCandidates: SummaryPayment[],
  range: { from: Date; to: Date },
): ShiftSummary {
  const received = shiftPayments.filter((p) => RECEIVED_STATUSES.has(p.status));
  const byMethodMap = new Map<PaymentMethod, { count: number; amount: number }>();
  for (const p of received) {
    const cur = byMethodMap.get(p.method) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += p.amount.amount;
    byMethodMap.set(p.method, cur);
  }
  const byMethod = [...byMethodMap.entries()]
    .map(([method, v]) => ({ method, count: v.count, amount: v.amount }))
    .sort((a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method));

  let refundTotal = 0;
  let refundCount = 0;
  let cashRefunds = 0;
  const from = range.from.getTime();
  const to = range.to.getTime();
  for (const p of refundCandidates) {
    for (const r of p.refunds ?? []) {
      const at = new Date(r.refundedAt).getTime();
      if (at < from || at > to) continue;
      refundTotal += r.amount.amount;
      refundCount += 1;
      if (p.method === 'cash') cashRefunds += r.amount.amount;
    }
  }

  return {
    byMethod,
    totalReceived: received.reduce((acc, p) => acc + p.amount.amount, 0),
    paymentCount: received.length,
    paidOrderCount: new Set(received.map((p) => p.orderId)).size,
    cashReceived: byMethodMap.get('cash')?.amount ?? 0,
    cashRefunds,
    refundTotal,
    refundCount,
  };
}

/** Tiền mặt dự kiến trong két = đầu ca + tiền mặt thu − tiền mặt hoàn. */
export function expectedCashOf(openingCash: number, summary: ShiftSummary): number {
  return openingCash + summary.cashReceived - summary.cashRefunds;
}

/** Lùi `days` ngày từ chuỗi YYYY-MM-DD (lịch thuần, không phụ thuộc múi giờ). */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

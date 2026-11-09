import { computeShiftSummary, expectedCashOf, shiftYmd, SummaryPayment } from './shift-summary';

const at = (iso: string) => new Date(iso);
const pay = (
  orderId: string,
  method: SummaryPayment['method'],
  amount: number,
  status: SummaryPayment['status'] = 'succeeded',
  refunds: Array<{ amount: number; at: string }> = [],
): SummaryPayment => ({
  orderId,
  method,
  status,
  amount: { amount },
  refunds: refunds.map((r) => ({ amount: { amount: r.amount }, refundedAt: at(r.at) })),
});

describe('computeShiftSummary', () => {
  const range = { from: at('2026-11-10T01:00:00Z'), to: at('2026-11-10T10:00:00Z') };

  it('gộp theo phương thức, bỏ qua pending/failed, đếm đơn khác nhau', () => {
    const payments = [
      pay('o1', 'cash', 20_000),
      pay('o1', 'vietqr', 34_000),
      pay('o2', 'cash', 50_000),
      pay('o3', 'card', 10_000, 'failed'),
      pay('o4', 'momo', 10_000, 'pending'),
    ];
    const s = computeShiftSummary(payments, [], range);
    expect(s.byMethod).toEqual([
      { method: 'cash', count: 2, amount: 70_000 },
      { method: 'vietqr', count: 1, amount: 34_000 },
    ]);
    expect(s.totalReceived).toBe(104_000);
    expect(s.paymentCount).toBe(3);
    expect(s.paidOrderCount).toBe(2);
    expect(s.cashReceived).toBe(70_000);
    expect(s.cashRefunds).toBe(0);
  });

  it('chỉ tính hoàn tiền trong khoảng của ca; tiền mặt hoàn trừ vào tiền dự kiến', () => {
    const refunded = pay('o1', 'cash', 50_000, 'partially_refunded', [
      { amount: 10_000, at: '2026-11-10T05:00:00Z' },
      { amount: 5_000, at: '2026-11-10T11:00:00Z' }, // sau ca
    ]);
    const qrRefund = pay('o2', 'vietqr', 30_000, 'refunded', [
      { amount: 30_000, at: '2026-11-10T02:00:00Z' },
    ]);
    const s = computeShiftSummary([refunded], [refunded, qrRefund], range);
    // payment đã hoàn vẫn tính là đã thu (hoàn tiền trừ riêng)
    expect(s.cashReceived).toBe(50_000);
    expect(s.cashRefunds).toBe(10_000);
    expect(s.refundTotal).toBe(40_000);
    expect(s.refundCount).toBe(2);
    expect(expectedCashOf(500_000, s)).toBe(540_000);
  });

  it('ca trống', () => {
    const s = computeShiftSummary([], [], range);
    expect(s).toMatchObject({ totalReceived: 0, paymentCount: 0, paidOrderCount: 0, byMethod: [] });
    expect(expectedCashOf(100_000, s)).toBe(100_000);
  });
});

describe('shiftYmd', () => {
  it('lùi ngày qua tháng/năm', () => {
    expect(shiftYmd('2026-11-10', -6)).toBe('2026-11-04');
    expect(shiftYmd('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftYmd('2026-01-01', -1)).toBe('2025-12-31');
  });
});

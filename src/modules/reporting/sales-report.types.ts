/** Báo cáo bán hàng theo khoảng ngày — mọi số tiền là số nguyên VND. */
export interface SalesReport {
  venueId: string | null;
  timezone: string;
  from: string;
  to: string;
  currency: 'VND';
  totals: {
    /** Tiền đã thu (succeeded/partially_refunded/refunded) trong khoảng − tiền hoàn trong khoảng. */
    netRevenue: number;
    /** Tổng tiền đã thu trong khoảng (trước khi trừ hoàn). */
    collected: number;
    /** Tổng tiền hoàn trong khoảng. */
    refunds: number;
    /** Tổng giá trị đơn không bị huỷ (tạo trong khoảng). */
    grossOrderValue: number;
    orders: number;
    cancelledOrders: number;
    /** grossOrderValue / orders (làm tròn). */
    averageTicket: number;
    discountTotal: number;
    serviceChargeTotal: number;
  };
  daily: Array<{ date: string; revenue: number; orders: number }>;
  byPaymentMethod: Array<{ method: string; amount: number; refunded: number; count: number }>;
  topItems: Array<{ menuItemId: string; name: string; quantity: number; revenue: number }>;
  byHour: Array<{ hour: number; orders: number; revenue: number }>;
  byStaff: Array<{
    /** null = đơn không gắn nhân viên (khách tự gọi qua QR...). */
    userId: string | null;
    displayName: string;
    paymentsCount: number;
    paymentsAmount: number;
    ordersCreated: number;
  }>;
}

/**
 * Quy ước room Socket.IO (namespace /realtime).
 *  - Nhân viên gắn venue           → venueRoom
 *  - Owner/admin toàn tenant       → tenantRoom (nhận sự kiện mọi venue)
 *  - Khách quét QR (table session) → tableRoom của đúng bàn
 * Room luôn kèm tenantId để không thể trùng giữa các tenant.
 */
export const venueRoom = (tenantId: string, venueId: string) => `t:${tenantId}:v:${venueId}`;
export const tenantRoom = (tenantId: string) => `t:${tenantId}`;
export const tableRoom = (tenantId: string, tableId: string) => `t:${tenantId}:table:${tableId}`;

/** Sự kiện server → client. Payload chỉ chứa id + trạng thái; client tự gọi API để lấy chi tiết. */
export const RealtimeEvent = {
  OrderChanged: 'order.changed',
  TableChanged: 'table.changed',
  PaymentChanged: 'payment.changed',
  Ready: 'realtime.ready',
} as const;

export interface OrderChangedPayload {
  op: 'insert' | 'update' | 'replace' | 'delete';
  id: string;
  venueId: string;
  tableId: string | null;
  tableName: string | null;
  orderNumber: string;
  status: string;
  source: string;
  /** Số món theo trạng thái bếp (chỉ món đã gửi bếp) — để client báo "món đã xong" */
  kitchen: { queued: number; preparing: number; ready: number };
  /** Khách báo thanh toán từ trang QR (chờ nhân viên xác nhận) — để client báo ngay */
  paymentRequest: { method: string; amount: number; requestedAt: string } | null;
}

export interface TableChangedPayload {
  id: string;
  venueId: string;
  status: string;
}

export interface PaymentChangedPayload {
  id: string;
  venueId: string;
  orderId: string;
  amount: number;
  method: string;
}

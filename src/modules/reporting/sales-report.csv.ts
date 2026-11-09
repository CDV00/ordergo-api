import type { SalesReport } from './sales-report.types';

/** BOM UTF-8 để Excel nhận đúng tiếng Việt. */
export const CSV_BOM = '﻿';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Tiền mặt',
  vietqr: 'VietQR',
  momo: 'MoMo',
  vnpay: 'VNPay',
  zalopay: 'ZaloPay',
  card: 'Thẻ',
  bank_transfer: 'Chuyển khoản',
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

/**
 * 1 ô CSV: chống CSV/formula injection (ô chuỗi bắt đầu bằng = + - @ hoặc tab/CR → thêm `'`),
 * rồi bọc nháy kép nếu có dấu phẩy, nháy kép hoặc xuống dòng.
 * Số (number) được giữ nguyên để Excel cộng được — kể cả số âm.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(',');
}

/**
 * Dựng file CSV báo cáo bán hàng (đã có BOM, xuống dòng CRLF cho Excel).
 * Trả về nội dung + số dòng dữ liệu (không tính tiêu đề/dòng trống) để ghi audit.
 */
export function buildSalesCsv(
  report: SalesReport,
  meta: { venueName: string | null; stampLine: string },
): { content: string; rows: number } {
  const lines: string[] = [];
  let rows = 0;
  const section = (title: string, header: string[], data: Array<Array<string | number>>) => {
    lines.push(csvRow([title]));
    lines.push(csvRow(header));
    for (const r of data) lines.push(csvRow(r));
    rows += data.length;
    lines.push('');
  };

  const t = report.totals;
  lines.push(csvRow(['Báo cáo bán hàng']));
  if (meta.venueName) lines.push(csvRow(['Cơ sở', meta.venueName]));
  lines.push(csvRow(['Từ ngày', report.from]));
  lines.push(csvRow(['Đến ngày', report.to]));
  lines.push('');

  section(
    'Tổng quan',
    ['Chỉ số', 'Giá trị'],
    [
      ['Doanh thu thuần (VND)', t.netRevenue],
      ['Tiền đã thu (VND)', t.collected],
      ['Tiền hoàn (VND)', t.refunds],
      ['Tổng giá trị đơn (VND)', t.grossOrderValue],
      ['Số đơn', t.orders],
      ['Số đơn huỷ', t.cancelledOrders],
      ['Giá trị TB/đơn (VND)', t.averageTicket],
      ['Giảm giá (VND)', t.discountTotal],
      ['Phí dịch vụ (VND)', t.serviceChargeTotal],
    ],
  );

  if (report.byVenue) {
    section(
      'Theo chi nhánh',
      ['Chi nhánh', 'Doanh thu (VND)', 'Số đơn', 'Giá trị TB/đơn (VND)'],
      report.byVenue.map((v) => [v.venueName, v.revenue, v.orders, v.averageTicket]),
    );
  }

  section(
    'Theo ngày',
    ['Ngày', 'Doanh thu (VND)', 'Số đơn'],
    report.daily.map((d) => [d.date, d.revenue, d.orders]),
  );

  section(
    'Phương thức thanh toán',
    ['Phương thức', 'Số tiền (VND)', 'Đã hoàn (VND)', 'Số giao dịch'],
    report.byPaymentMethod.map((m) => [
      paymentMethodLabel(m.method),
      m.amount,
      m.refunded,
      m.count,
    ]),
  );

  section(
    'Món bán chạy',
    ['Món', 'Số lượng', 'Doanh thu (VND)'],
    report.topItems.map((i) => [i.name, i.quantity, i.revenue]),
  );

  section(
    'Nhân viên',
    ['Nhân viên', 'Số lần thu', 'Tiền thu (VND)', 'Đơn tạo'],
    report.byStaff.map((s) => [s.displayName, s.paymentsCount, s.paymentsAmount, s.ordersCreated]),
  );

  lines.push(csvRow([meta.stampLine]));
  return { content: CSV_BOM + lines.join('\r\n') + '\r\n', rows };
}

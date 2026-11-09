import { buildSalesCsv, CSV_BOM, csvCell, csvRow } from './sales-report.csv';
import type { SalesReport } from './sales-report.types';

describe('CSV báo cáo', () => {
  it('escape dấu phẩy, nháy kép, xuống dòng', () => {
    expect(csvCell('Cà phê, sữa')).toBe('"Cà phê, sữa"');
    expect(csvCell('Bánh "flan"')).toBe('"Bánh ""flan"""');
    expect(csvCell('dòng 1\ndòng 2')).toBe('"dòng 1\ndòng 2"');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
    expect(csvCell(null)).toBe('');
    expect(csvCell('')).toBe('');
  });

  it('chống formula injection = + - @ (và tab/CR)', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+84901')).toBe("'+84901");
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    expect(csvCell('An toàn')).toBe('An toàn');
  });

  it('số giữ nguyên kể cả âm', () => {
    expect(csvCell(-5000)).toBe('-5000');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvRow(['a', 1, null])).toBe('a,1,');
  });

  it('buildSalesCsv: BOM, các phần, dòng đóng dấu cuối, đếm dòng', () => {
    const report: SalesReport = {
      venueId: 'v1',
      timezone: 'Asia/Ho_Chi_Minh',
      from: '2026-11-01',
      to: '2026-11-02',
      currency: 'VND',
      totals: {
        netRevenue: 100_000,
        collected: 110_000,
        refunds: 10_000,
        grossOrderValue: 120_000,
        orders: 3,
        cancelledOrders: 1,
        averageTicket: 40_000,
        discountTotal: 5_000,
        serviceChargeTotal: 0,
      },
      daily: [
        { date: '2026-11-01', revenue: 100_000, orders: 3 },
        { date: '2026-11-02', revenue: 0, orders: 0 },
      ],
      byPaymentMethod: [{ method: 'cash', amount: 100_000, refunded: 10_000, count: 2 }],
      topItems: [{ menuItemId: 'm1', name: '=Cà phê, đá', quantity: 3, revenue: 90_000 }],
      byHour: [],
      byStaff: [
        {
          userId: 'u1',
          displayName: 'Nguyễn Văn An',
          paymentsCount: 2,
          paymentsAmount: 110_000,
          ordersCreated: 3,
        },
      ],
    };
    const { content, rows } = buildSalesCsv(report, {
      venueName: 'Chi nhánh 1',
      stampLine: 'Xuất bởi: Nguyễn V** A* · 10/11/2026 08:00',
    });
    expect(content.startsWith(CSV_BOM)).toBe(true);
    const lines = content.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Báo cáo bán hàng');
    expect(lines).toContain('Tiền mặt,100000,10000,2');
    expect(lines).toContain(`"'=Cà phê, đá",3,90000`);
    expect(lines).toContain('Nguyễn Văn An,2,110000,3');
    expect(lines[lines.length - 1]).toBe('Xuất bởi: Nguyễn V** A* · 10/11/2026 08:00');
    // 9 chỉ số + 2 ngày + 1 phương thức + 1 món + 1 nhân viên
    expect(rows).toBe(14);
  });
});

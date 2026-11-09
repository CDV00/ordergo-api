import { BadRequestException } from '@nestjs/common';
import { buildByVenue, commonTimezone } from './report-scope';
import { buildSalesCsv } from './sales-report.csv';
import type { SalesReport } from './sales-report.types';

describe('commonTimezone', () => {
  it('mọi cơ sở cùng múi giờ → múi giờ đó', () => {
    expect(
      commonTimezone([{ timezone: 'Asia/Ho_Chi_Minh' }, { timezone: 'Asia/Ho_Chi_Minh' }]),
    ).toBe('Asia/Ho_Chi_Minh');
    expect(commonTimezone([{ timezone: 'Asia/Bangkok' }])).toBe('Asia/Bangkok');
  });

  it('thiếu múi giờ → mặc định; không có cơ sở → mặc định', () => {
    expect(commonTimezone([{ timezone: null }, { timezone: 'Asia/Ho_Chi_Minh' }])).toBe(
      'Asia/Ho_Chi_Minh',
    );
    expect(commonTimezone([])).toBe('Asia/Ho_Chi_Minh');
  });

  it('khác múi giờ → 400 MIXED_TIMEZONES', () => {
    let err: unknown;
    try {
      commonTimezone([{ timezone: 'Asia/Ho_Chi_Minh' }, { timezone: 'Asia/Tokyo' }]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'MIXED_TIMEZONES' });
  });
});

describe('buildByVenue', () => {
  const venues = [
    { id: 'q3', name: 'Quận 3' },
    { id: 'q1', name: 'Quận 1' },
    { id: 'q7', name: 'Quận 7' },
  ];

  it('mọi cơ sở có dòng (kể cả 0), sắp theo doanh thu giảm dần, TB đơn làm tròn', () => {
    const rows = buildByVenue(
      venues,
      new Map([
        ['q3', 100_000],
        ['q1', 250_000],
      ]),
      new Map([
        ['q3', { count: 3, gross: 100_000 }],
        ['q1', { count: 4, gross: 260_000 }],
      ]),
    );
    expect(rows).toEqual([
      { venueId: 'q1', venueName: 'Quận 1', revenue: 250_000, orders: 4, averageTicket: 65_000 },
      { venueId: 'q3', venueName: 'Quận 3', revenue: 100_000, orders: 3, averageTicket: 33_333 },
      { venueId: 'q7', venueName: 'Quận 7', revenue: 0, orders: 0, averageTicket: 0 },
    ]);
  });

  it('tổng các dòng = tổng toàn chuỗi; cơ sở đã xoá vẫn hiện', () => {
    const revenue = new Map([
      ['q3', 10_000],
      ['gone', 5_000],
    ]);
    const rows = buildByVenue(venues, revenue, new Map([['gone', { count: 1, gross: 5_000 }]]));
    expect(rows.reduce((s, r) => s + r.revenue, 0)).toBe(15_000);
    expect(rows.find((r) => r.venueId === 'gone')).toMatchObject({
      venueName: 'Cơ sở đã xoá',
      orders: 1,
    });
    // Bằng doanh thu (0) → giữ thứ tự cơ sở
    expect(rows.slice(2).map((r) => r.venueId)).toEqual(['q1', 'q7']);
  });

  it('doanh thu âm (hoàn nhiều hơn thu) vẫn giữ', () => {
    const rows = buildByVenue(venues.slice(0, 1), new Map([['q3', -2_000]]), new Map());
    expect(rows[0].revenue).toBe(-2_000);
  });
});

describe('CSV toàn chuỗi', () => {
  it('có phần "Theo chi nhánh" khi byVenue', () => {
    const report: SalesReport = {
      venueId: 'all',
      timezone: 'Asia/Ho_Chi_Minh',
      from: '2026-11-01',
      to: '2026-11-01',
      currency: 'VND',
      totals: {
        netRevenue: 0,
        collected: 0,
        refunds: 0,
        grossOrderValue: 0,
        orders: 0,
        cancelledOrders: 0,
        averageTicket: 0,
        discountTotal: 0,
        serviceChargeTotal: 0,
      },
      daily: [],
      byPaymentMethod: [],
      topItems: [],
      byHour: [],
      byStaff: [],
      byVenue: [
        {
          venueId: 'q1',
          venueName: 'Góc Phố, Q1',
          revenue: 50_000,
          orders: 2,
          averageTicket: 25_000,
        },
      ],
    };
    const { content, rows } = buildSalesCsv(report, {
      venueName: 'Tất cả cơ sở',
      stampLine: 'x',
    });
    const lines = content.slice(1).split('\r\n');
    expect(lines).toContain('Cơ sở,Tất cả cơ sở');
    expect(lines).toContain('Theo chi nhánh');
    expect(lines).toContain('"Góc Phố, Q1",50000,2,25000');
    // 9 chỉ số tổng quan + 1 chi nhánh
    expect(rows).toBe(10);
  });
});

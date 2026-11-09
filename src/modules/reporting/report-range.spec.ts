import { BadRequestException } from '@nestjs/common';
import {
  enumerateDays,
  formatStamp,
  isValidYmd,
  MAX_RANGE_DAYS,
  resolveRange,
  zeroFillDaily,
} from './report-range';

const TZ = 'Asia/Ho_Chi_Minh';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof BadRequestException) return (e.getResponse() as { code: string }).code;
    throw e;
  }
  return undefined;
}

describe('report-range', () => {
  it('isValidYmd loại ngày không tồn tại', () => {
    expect(isValidYmd('2026-02-28')).toBe(true);
    expect(isValidYmd('2024-02-29')).toBe(true);
    expect(isValidYmd('2026-02-29')).toBe(false);
    expect(isValidYmd('2026-13-01')).toBe(false);
    expect(isValidYmd('2026-1-01')).toBe(false);
    expect(isValidYmd(undefined)).toBe(false);
  });

  it('enumerateDays qua tháng/năm', () => {
    expect(enumerateDays('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(enumerateDays('2026-11-10', '2026-11-10')).toEqual(['2026-11-10']);
  });

  it('resolveRange tính mốc theo giờ VN', () => {
    const r = resolveRange('2026-11-01', '2026-11-03', TZ);
    expect(r.days).toHaveLength(3);
    expect(r.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-03T16:59:59.999Z');
  });

  it('thiếu ngày → hôm nay theo giờ cơ sở', () => {
    const now = new Date('2026-11-09T23:00:00Z'); // 06:00 10/11 giờ VN
    const r = resolveRange(undefined, undefined, TZ, now);
    expect([r.from, r.to]).toEqual(['2026-11-10', '2026-11-10']);
    expect(resolveRange('2026-11-05', undefined, TZ, now).to).toBe('2026-11-05');
  });

  it('kiểm tra khoảng', () => {
    expect(codeOf(() => resolveRange('2026-11-x', '2026-11-03', TZ))).toBe('INVALID_DATE');
    expect(codeOf(() => resolveRange('2026-11-05', '2026-11-03', TZ))).toBe('INVALID_RANGE');
    // 92 ngày: được; 93 ngày: không
    const from = '2026-01-01';
    const to92 = enumerateDays(from, '2026-12-31')[MAX_RANGE_DAYS - 1];
    expect(codeOf(() => resolveRange(from, to92, TZ))).toBeUndefined();
    const to93 = enumerateDays(from, '2026-12-31')[MAX_RANGE_DAYS];
    expect(codeOf(() => resolveRange(from, to93, TZ))).toBe('RANGE_TOO_LARGE');
  });

  it('zeroFillDaily điền 0 và giữ thứ tự', () => {
    const days = enumerateDays('2026-11-01', '2026-11-03');
    expect(
      zeroFillDaily(days, new Map([['2026-11-02', 50_000]]), new Map([['2026-11-03', 2]])),
    ).toEqual([
      { date: '2026-11-01', revenue: 0, orders: 0 },
      { date: '2026-11-02', revenue: 50_000, orders: 0 },
      { date: '2026-11-03', revenue: 0, orders: 2 },
    ]);
  });

  it('formatStamp dd/MM/yyyy HH:mm theo giờ cơ sở', () => {
    expect(formatStamp(new Date('2026-11-09T17:05:00Z'), TZ)).toBe('10/11/2026 00:05');
  });
});

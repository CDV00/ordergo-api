import { dayRange, hourIn, todayYmd } from './time';

describe('time utils (Asia/Ho_Chi_Minh)', () => {
  it('đầu ngày VN = 17:00 UTC hôm trước', () => {
    const r = dayRange('2026-11-10', 'Asia/Ho_Chi_Minh');
    expect(r.start.toISOString()).toBe('2026-11-09T17:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-10T16:59:59.999Z');
  });

  it('"hôm nay" tính theo giờ VN, không theo UTC', () => {
    // 23:30 ngày 9/11 giờ VN = 16:30 UTC; 06:00 ngày 10/11 VN = 23:00 UTC ngày 9/11
    expect(todayYmd('Asia/Ho_Chi_Minh', new Date('2026-11-09T16:30:00Z'))).toBe('2026-11-09');
    expect(todayYmd('Asia/Ho_Chi_Minh', new Date('2026-11-09T23:00:00Z'))).toBe('2026-11-10');
  });

  it('ymd không hợp lệ → hôm nay', () => {
    const now = new Date('2026-11-09T23:00:00Z');
    expect(dayRange('abc', 'Asia/Ho_Chi_Minh', now).ymd).toBe('2026-11-10');
    expect(dayRange(undefined, 'Asia/Ho_Chi_Minh', now).ymd).toBe('2026-11-10');
  });

  it('giờ theo VN', () => {
    expect(hourIn(new Date('2026-11-10T01:15:00Z'), 'Asia/Ho_Chi_Minh')).toBe(8);
  });
});

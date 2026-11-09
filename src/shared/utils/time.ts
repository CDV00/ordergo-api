/**
 * Tiện ích ngày giờ theo múi giờ của cơ sở (venue.timezone, mặc định Asia/Ho_Chi_Minh).
 * Không phụ thuộc TZ của server — chạy đúng cả trong container UTC.
 */

export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const get = (type: string) =>
    Number(fmt.formatToParts(date).find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Độ lệch (ms) của múi giờ so với UTC tại thời điểm `date`. VN = +7h. */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Ngày hiện tại (YYYY-MM-DD) theo múi giờ. */
export function todayYmd(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Giờ (0–23) của `date` theo múi giờ. */
export function hourIn(date: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  return zonedParts(date, timeZone).hour;
}

/**
 * Khoảng [00:00:00.000, 23:59:59.999] của ngày `ymd` theo múi giờ, trả về Date (UTC instant).
 * `ymd` rỗng/không hợp lệ → hôm nay.
 */
export function dayRange(
  ymd: string | undefined | null,
  timeZone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): { ymd: string; start: Date; end: Date } {
  const valid = typeof ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ymd);
  const day = valid ? ymd : todayYmd(timeZone, now);
  const [y, m, d] = day.split('-').map(Number);
  // Lấy offset tại giữa trưa ngày đó để tránh lệch ở điểm chuyển DST (VN không có DST).
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const offset = offsetMs(noonUtc, timeZone);
  const start = new Date(Date.UTC(y, m - 1, d) - offset);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { ymd: day, start, end };
}

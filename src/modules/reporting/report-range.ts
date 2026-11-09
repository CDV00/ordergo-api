import { BadRequestException } from '@nestjs/common';
import { dayRange, todayYmd } from '../../shared/utils/time';

/** Khoảng tối đa cho 1 báo cáo (ngày, tính cả 2 đầu). */
export const MAX_RANGE_DAYS = 92;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD hợp lệ thật sự (loại 2026-02-30, 2026-13-01...). */
export function isValidYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !YMD_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Ngày lịch → số ngày kể từ epoch (không phụ thuộc múi giờ — chỉ là phép tính lịch). */
function ymdToEpochDay(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function epochDayToYmd(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Mọi ngày từ `from` đến `to` (cả 2 đầu), dạng YYYY-MM-DD. */
export function enumerateDays(from: string, to: string): string[] {
  const a = ymdToEpochDay(from);
  const b = ymdToEpochDay(to);
  const out: string[] = [];
  for (let i = a; i <= b; i++) out.push(epochDayToYmd(i));
  return out;
}

export interface ReportRange {
  from: string;
  to: string;
  days: string[];
  /** Mốc UTC tương ứng 00:00 ngày `from` và 23:59:59.999 ngày `to` theo giờ cơ sở. */
  start: Date;
  end: Date;
}

/**
 * Kiểm tra + chuẩn hoá khoảng ngày theo múi giờ của cơ sở.
 * Thiếu `from`/`to` → hôm nay. Sai định dạng → 400 INVALID_DATE; from > to → 400 INVALID_RANGE;
 * quá {@link MAX_RANGE_DAYS} ngày → 400 RANGE_TOO_LARGE.
 */
export function resolveRange(
  from: string | undefined | null,
  to: string | undefined | null,
  timeZone: string,
  now: Date = new Date(),
): ReportRange {
  const today = todayYmd(timeZone, now);
  const f = from || to || today;
  const t = to || from || today;
  if (!isValidYmd(f) || !isValidYmd(t)) {
    throw new BadRequestException({
      code: 'INVALID_DATE',
      message: 'Ngày không hợp lệ (định dạng YYYY-MM-DD).',
    });
  }
  const span = ymdToEpochDay(t) - ymdToEpochDay(f) + 1;
  if (span < 1) {
    throw new BadRequestException({
      code: 'INVALID_RANGE',
      message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.',
    });
  }
  if (span > MAX_RANGE_DAYS) {
    throw new BadRequestException({
      code: 'RANGE_TOO_LARGE',
      message: `Chỉ xem được tối đa ${MAX_RANGE_DAYS} ngày mỗi lần.`,
      details: { maxDays: MAX_RANGE_DAYS, days: span },
    });
  }
  return {
    from: f,
    to: t,
    days: enumerateDays(f, t),
    start: dayRange(f, timeZone).start,
    end: dayRange(t, timeZone).end,
  };
}

/** Điền 0 cho mọi ngày không có dữ liệu, giữ đúng thứ tự `days`. */
export function zeroFillDaily(
  days: string[],
  revenueByDay: Map<string, number>,
  ordersByDay: Map<string, number>,
): Array<{ date: string; revenue: number; orders: number }> {
  return days.map((date) => ({
    date,
    revenue: revenueByDay.get(date) ?? 0,
    orders: ordersByDay.get(date) ?? 0,
  }));
}

/** "dd/MM/yyyy HH:mm" theo múi giờ cơ sở — dùng cho dòng "Xuất bởi". */
export function formatStamp(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

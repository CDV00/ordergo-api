/**
 * Dựng filter tìm khách từ ô tìm kiếm. Hàm thuần — không log `q` (là PII: SĐT/tên khách).
 */

/** Ký tự phân cách thường gặp khi gõ SĐT: "090 123 4567", "090.123.4567", "(090)-123" */
const PHONE_SEPARATORS = /[\s.\-()]/g;
const PHONE_LIKE = /^\+?\d{6,15}$/;

/** Chuẩn hoá SĐT giống `AuthService.normalizePhone`: "0901234567" → "+84901234567". */
export function normalizePhone(p: string): string {
  let s = p.trim();
  if (s.startsWith('0')) s = '+84' + s.substring(1);
  if (!s.startsWith('+')) s = '+' + s;
  return s;
}

/** Trả SĐT đã chuẩn hoá nếu `q` trông như SĐT (chỉ số, có thể có +84/0), ngược lại null. */
export function phoneFromQuery(q: string): string | null {
  const compact = q.trim().replace(PHONE_SEPARATORS, '');
  if (!PHONE_LIKE.test(compact)) return null;
  return normalizePhone(compact);
}

/** Escape ký tự đặc biệt của regex để tìm "chứa chuỗi" an toàn (chống ReDoS / regex injection). */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Filter Mongo cho ô tìm kiếm: SĐT → khớp chính xác; còn lại → tên chứa chuỗi (không phân biệt hoa thường). */
export function searchFilter(q: string | undefined): Record<string, unknown> {
  const text = q?.trim();
  if (!text) return {};
  const phone = phoneFromQuery(text);
  if (phone) return { phone };
  return { name: { $regex: escapeRegex(text), $options: 'i' } };
}

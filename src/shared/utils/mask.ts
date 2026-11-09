/**
 * Che dữ liệu cá nhân (PII) — MỘT nơi duy nhất cho toàn API. Mặc định mọi danh sách/API trả bản đã che;
 * bản đầy đủ chỉ qua endpoint "reveal" có kiểm quyền + ghi audit (AuditService).
 */

/** "+84901234567" / "0901234567" → "090****567" */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const local = phone.startsWith('+84') ? '0' + phone.slice(3) : phone;
  if (local.length <= 6) return '*'.repeat(local.length);
  return `${local.slice(0, 3)}${'*'.repeat(local.length - 6)}${local.slice(-3)}`;
}

/** "Nguyễn Văn An" → "Nguyễn V** A*" (giữ họ, mỗi tên sau giữ chữ đầu) */
export function maskName(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1)
    return parts[0].length <= 1 ? parts[0] : parts[0][0] + '*'.repeat(parts[0].length - 1);
  return [
    parts[0],
    ...parts.slice(1).map((p) => p[0] + '*'.repeat(Math.max(p.length - 1, 1))),
  ].join(' ');
}

/** "an.nguyen@gmail.com" → "a*******@gmail.com" */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}${'*'.repeat(Math.max(at - 1, 1))}${email.slice(at)}`;
}

/** Ngày sinh → chỉ giữ năm: "**\/**\/1990" */
export function maskBirthday(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  return `**/**/${date.getUTCFullYear()}`;
}

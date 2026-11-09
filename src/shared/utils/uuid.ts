import { randomBytes } from 'node:crypto';

/**
 * Sinh UUID v7 (RFC 9562): 48 bit timestamp ms + version + random.
 * ID tăng dần theo thời gian → index B-tree Mongo chèn tuần tự, sort theo id ≈ sort theo thời gian tạo.
 *
 * Tự cài bằng node:crypto thay vì package `uuid` (v12+ chỉ còn bản ESM, `require()` lỗi
 * ERR_REQUIRE_ESM trên Node < 20.19 và trong Jest).
 */
export function newId(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

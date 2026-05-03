/**
 * Sinh URL-safe slug từ tên Việt Nam.
 *   "Cafe ABC"        → "cafe-abc"
 *   "Quán Phở 24"     → "quan-pho-24"
 *   "Đặc sản Hà Nội"  → "dac-san-ha-noi"
 */
export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'tenant';
}

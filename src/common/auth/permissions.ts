/**
 * Kiểm quyền:
 *  - `*` (owner / tenant_admin) có mọi quyền
 *  - `<resource>.manage` bao gồm mọi quyền `<resource>.*` (vd `order.manage` ⊇ `order.pay`)
 *  - còn lại so khớp chính xác
 */
export function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes('*') || granted.includes(required)) return true;
  const dot = required.indexOf('.');
  if (dot > 0 && granted.includes(`${required.substring(0, dot)}.manage`)) return true;
  return false;
}

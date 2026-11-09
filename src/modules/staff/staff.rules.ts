import type { RoleCode } from '../tenant/schemas/membership.schema';
import { hasPermission } from '../../common/auth/permissions';

/** Vai trò được mời/gán qua màn Nhân viên (owner chỉ có 1, tạo lúc setup wizard). */
export const ASSIGNABLE_ROLES = ['venue_manager', 'cashier', 'server', 'kitchen'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

const RANK: Partial<Record<RoleCode, number>> = {
  owner: 100,
  tenant_admin: 90,
  venue_manager: 50,
  accountant: 40,
  cashier: 20,
  server: 10,
  kitchen: 10,
};

/**
 * Người thao tác chỉ được quản lý vai trò thấp hơn mình:
 *  - owner / tenant_admin (`*`): mọi vai trò gán được
 *  - venue_manager (staff.invite): chỉ thu ngân / phục vụ / bếp
 * Không ai sửa được owner hay chính mình qua màn này.
 */
export function canManageRole(
  actorPermissions: string[],
  actorRole: RoleCode | null,
  target: RoleCode,
): boolean {
  if (target === 'owner') return false;
  if (actorPermissions.includes('*')) return true;
  if (!hasPermission(actorPermissions, 'staff.invite')) return false;
  const actorRank = actorRole ? (RANK[actorRole] ?? 0) : 0;
  return (RANK[target] ?? 0) < actorRank;
}

/** Mật khẩu tạm 10 ký tự dễ đọc (bỏ 0/O/1/l/I) — chỉ trả về 1 lần cho người mời. */
export function generateTempPassword(random: (n: number) => Buffer): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = random(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

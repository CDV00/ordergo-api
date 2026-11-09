import { randomBytes } from 'node:crypto';
import { canManageRole, generateTempPassword } from './staff.rules';

describe('canManageRole', () => {
  it('owner (*) quản lý mọi vai trò trừ owner', () => {
    expect(canManageRole(['*'], 'owner', 'venue_manager')).toBe(true);
    expect(canManageRole(['*'], 'owner', 'kitchen')).toBe(true);
    expect(canManageRole(['*'], 'owner', 'owner')).toBe(false);
  });

  it('quản lý chỉ quản lý vai trò thấp hơn', () => {
    const perms = ['staff.invite', 'order.manage'];
    expect(canManageRole(perms, 'venue_manager', 'cashier')).toBe(true);
    expect(canManageRole(perms, 'venue_manager', 'kitchen')).toBe(true);
    expect(canManageRole(perms, 'venue_manager', 'venue_manager')).toBe(false);
  });

  it('không có staff.invite thì không quản lý được ai', () => {
    expect(canManageRole(['order.create'], 'cashier', 'server')).toBe(false);
  });
});

describe('generateTempPassword', () => {
  it('10 ký tự, không có ký tự dễ nhầm', () => {
    for (let i = 0; i < 50; i++) {
      const p = generateTempPassword(randomBytes);
      expect(p).toHaveLength(10);
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });
});

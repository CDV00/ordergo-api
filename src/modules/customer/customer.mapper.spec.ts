import { toListItem, toProfile, toRevealed } from './customer.mapper';
import type { CustomerDoc } from './schemas/customer.schema';

const customer = {
  id: 'c1',
  tenantId: 't1',
  status: 'verified',
  name: 'Nguyễn Văn An',
  phone: '+84901234567',
  email: 'an.nguyen@gmail.com',
  birthday: new Date('1990-05-17T00:00:00.000Z'),
  tags: ['VIP'],
  note: 'Thích ít đá',
  stats: {
    totalSpent: { amount: 250000, currency: 'VND' },
    orderCount: 3,
    firstOrderAt: new Date('2026-01-01T00:00:00Z'),
    lastOrderAt: new Date('2026-11-01T00:00:00Z'),
  },
  consents: {
    marketing: { granted: true, grantedAt: null },
    crossTenantShare: { granted: false, grantedAt: null },
    privacyPolicyAcceptedAt: null,
  },
  dataErasureRequestedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
} as unknown as CustomerDoc;

describe('customer.mapper', () => {
  it('danh sách chỉ chứa giá trị đã che', () => {
    const item = toListItem(customer, null);
    expect(item.name).toBe('Nguyễn V** A*');
    expect(item.phone).toBe('090****567');
    expect(JSON.stringify(item)).not.toContain('0901234567');
    expect(JSON.stringify(item)).not.toContain('Văn An');
    expect(item.visits).toBe(3);
    expect(item.loyalty).toBeNull();
  });

  it('hồ sơ che cả email + ngày sinh', () => {
    const p = toProfile(customer);
    expect(p.email).toBe('a********@gmail.com');
    expect(p.birthday).toBe('**/**/1990');
    const json = JSON.stringify(p);
    expect(json).not.toContain('an.nguyen');
    expect(json).not.toContain('1990-05-17');
    expect(json).not.toContain('+84901234567');
  });

  it('reveal trả giá trị gốc, ngày sinh dạng YYYY-MM-DD', () => {
    expect(toRevealed(customer)).toEqual({
      name: 'Nguyễn Văn An',
      phone: '+84901234567',
      email: 'an.nguyen@gmail.com',
      birthday: '1990-05-17',
    });
  });
});

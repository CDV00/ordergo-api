import { escapeRegex, normalizePhone, phoneFromQuery, searchFilter } from './customer-search';

describe('customer-search', () => {
  it('chuẩn hoá SĐT giống AuthService', () => {
    expect(normalizePhone('0901234567')).toBe('+84901234567');
    expect(normalizePhone('+84901234567')).toBe('+84901234567');
    expect(normalizePhone('84901234567')).toBe('+84901234567');
  });

  it('nhận diện chuỗi giống SĐT (bỏ khoảng trắng, dấu chấm, gạch)', () => {
    expect(phoneFromQuery('090 123 4567')).toBe('+84901234567');
    expect(phoneFromQuery('090.123.4567')).toBe('+84901234567');
    expect(phoneFromQuery('+84 90-123-4567')).toBe('+84901234567');
    expect(phoneFromQuery('Lan')).toBeNull();
    expect(phoneFromQuery('123')).toBeNull();
    expect(phoneFromQuery('09a1234567')).toBeNull();
  });

  it('escape ký tự đặc biệt của regex', () => {
    const escaped = escapeRegex('a.b*c(d)[e]+?^$|\\');
    expect(new RegExp(escaped).test('a.b*c(d)[e]+?^$|\\')).toBe(true);
    expect(new RegExp(escaped).test('aXb*c(d)[e]+?^$|\\')).toBe(false);
  });

  it('filter: SĐT → khớp chính xác, tên → regex không phân biệt hoa thường', () => {
    expect(searchFilter(undefined)).toEqual({});
    expect(searchFilter('   ')).toEqual({});
    expect(searchFilter('0901234567')).toEqual({ phone: '+84901234567' });
    expect(searchFilter(' Lan (VIP) ')).toEqual({
      name: { $regex: 'Lan \\(VIP\\)', $options: 'i' },
    });
  });
});

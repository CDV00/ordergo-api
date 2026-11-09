import { maskBirthday, maskEmail, maskName, maskPhone } from './mask';

describe('mask PII', () => {
  it('phone', () => {
    expect(maskPhone('+84901234567')).toBe('090****567');
    expect(maskPhone('0901234567')).toBe('090****567');
    expect(maskPhone(null)).toBeNull();
  });

  it('name', () => {
    expect(maskName('Nguyễn Văn An')).toBe('Nguyễn V** A*');
    expect(maskName('Hà')).toBe('H*');
  });

  it('email', () => {
    expect(maskEmail('an.nguyen@gmail.com')).toBe('a********@gmail.com');
  });

  it('birthday chỉ giữ năm', () => {
    expect(maskBirthday(new Date(Date.UTC(1990, 4, 12)))).toBe('**/**/1990');
  });
});

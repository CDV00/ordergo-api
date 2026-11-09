import { isSwaggerEnabled, parseTrustProxy } from './security';

describe('parseTrustProxy', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['0', false],
    ['false', false],
    ['true', true],
    ['1', 1],
    ['2', 2],
    ['loopback', 'loopback'],
    ['10.0.0.0/8, 172.16.0.0/12', '10.0.0.0/8, 172.16.0.0/12'],
  ])('%p → %p', (raw, expected) => {
    expect(parseTrustProxy(raw)).toBe(expected);
  });
});

describe('isSwaggerEnabled', () => {
  it('mặc định tắt ở production, bật ở môi trường khác', () => {
    expect(isSwaggerEnabled('production', undefined)).toBe(false);
    expect(isSwaggerEnabled('development', undefined)).toBe(true);
    expect(isSwaggerEnabled('staging', undefined)).toBe(true);
  });

  it('SWAGGER_ENABLED ghi đè', () => {
    expect(isSwaggerEnabled('production', true)).toBe(true);
    expect(isSwaggerEnabled('development', false)).toBe(false);
  });
});

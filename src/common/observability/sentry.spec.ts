import type { ErrorEvent } from '@sentry/node';
import { captureServerError, initSentry, scrubBreadcrumb, scrubEvent } from './sentry';

describe('Sentry scrub', () => {
  it('xoá body, cookie, query, header nhạy cảm và user', () => {
    const event = {
      type: undefined,
      message: 'E11000 duplicate key { phone: "+84901234567" }',
      user: { id: 'u1', ip_address: '1.2.3.4' },
      request: {
        url: 'https://api.example.com/v1/customers?phone=0901234567#x',
        query_string: 'phone=0901234567',
        data: { password: 'secret' },
        cookies: { og_sid: 'abc' },
        headers: {
          Authorization: 'Bearer xyz',
          Cookie: 'og_sid=abc',
          'User-Agent': 'jest',
          'X-Request-Id': 'r1',
        },
      },
      exception: { values: [{ type: 'Error', value: 'dup 0901234567' }] },
    } as ErrorEvent;

    const out = scrubEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.url).toBe('https://api.example.com/v1/customers');
    expect(out.request?.headers).toEqual({ 'User-Agent': 'jest', 'X-Request-Id': 'r1' });
    expect(out.message).not.toContain('901234567');
    expect(out.exception?.values?.[0].value).toBe('dup 090****567');
  });

  it('bỏ query khỏi URL của breadcrumb', () => {
    const b = scrubBreadcrumb({
      category: 'http',
      data: { url: 'http://x/v1/a?token=1', 'http.query': '?token=1', method: 'GET' },
    });
    expect(b.data).toEqual({ url: 'http://x/v1/a', method: 'GET' });
  });

  it('không có SENTRY_DSN → không khởi tạo, capture là no-op', () => {
    expect(initSentry({})).toBe(false);
    expect(() =>
      captureServerError(new Error('x'), {
        requestId: 'r',
        method: 'GET',
        route: '/v1/x',
        status: 500,
      }),
    ).not.toThrow();
  });
});

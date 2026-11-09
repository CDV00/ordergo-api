import * as Sentry from '@sentry/node';
import type { Breadcrumb, ErrorEvent } from '@sentry/node';

/**
 * Sentry (tuỳ chọn) — chỉ khởi tạo khi có SENTRY_DSN; không có thì mọi hàm ở đây là no-op.
 * Chỉ báo lỗi 5xx (AllExceptionsFilter gọi captureServerError). Không gửi PII:
 * sendDefaultPii=false, xoá body/cookie/header/query, che số điện thoại trong message.
 */

let enabled = false;

/** Header được giữ lại (không chứa định danh). Authorization, Cookie... luôn bị bỏ. */
const SAFE_HEADERS = new Set(['user-agent', 'content-type', 'content-length', 'x-request-id']);

/** SĐT VN (+84xxxxxxxxx / 0xxxxxxxxx) trong message/stack (vd lỗi E11000 kèm giá trị). */
const PHONE_RE = /(\+84|\b0)\d{8,10}\b/g;

function maskPhones(s: string): string {
  return s.replace(PHONE_RE, (m) => `${m.slice(0, 3)}****${m.slice(-3)}`);
}

function stripQuery(url: string): string {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}

/** Lọc PII khỏi event trước khi gửi. Export để unit test. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const req = event.request;
    delete req.data;
    delete req.cookies;
    delete req.query_string;
    delete req.env;
    if (req.url) req.url = stripQuery(req.url);
    if (req.headers) {
      req.headers = Object.fromEntries(
        Object.entries(req.headers).filter(([k]) => SAFE_HEADERS.has(k.toLowerCase())),
      );
    }
  }
  delete event.user;
  if (event.message) event.message = maskPhones(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = maskPhones(ex.value);
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb {
  const out: Breadcrumb = { ...b };
  if (out.message) out.message = maskPhones(out.message);
  if (out.data) {
    const data: Record<string, unknown> = { ...out.data };
    if (typeof data.url === 'string') data.url = stripQuery(data.url);
    delete data['http.query'];
    delete data['http.fragment'];
    out.data = data;
  }
  return out;
}

export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  const rate = Number(env.SENTRY_TRACES_SAMPLE_RATE ?? 0);
  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'development',
    tracesSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0,
    sendDefaultPii: false,
    // Không tự bắt unhandled qua console/breadcrumb log (log có thể chứa dữ liệu nghiệp vụ).
    integrations: (defaults) => defaults.filter((i) => i.name !== 'Console'),
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (b) => scrubBreadcrumb(b),
  });
  enabled = true;
  return true;
}

/** Báo lỗi 5xx kèm requestId (không kèm user/body). No-op khi Sentry chưa bật. */
export function captureServerError(
  exception: unknown,
  ctx: { requestId: string; method: string; route: string; status: number },
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('request_id', ctx.requestId);
    scope.setTag('http.status_code', String(ctx.status));
    scope.setContext('request_meta', { method: ctx.method, route: ctx.route });
    Sentry.captureException(exception);
  });
}

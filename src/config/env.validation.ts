import * as Joi from 'joi';

/** Cờ bật/tắt dạng "1"/"0"/"true"/"false". */
const flag = () => Joi.boolean().truthy('1').falsy('0', '');

/**
 * Production: chặn khởi động khi secret JWT còn là giá trị mẫu hoặc access = refresh
 * (lộ một secret là giả mạo được cả hai loại token).
 */
function assertProductionSecrets(env: Record<string, unknown>): Record<string, unknown> {
  if (env.NODE_ENV !== 'production') return env;
  const access = typeof env.JWT_ACCESS_SECRET === 'string' ? env.JWT_ACCESS_SECRET : '';
  const refresh = typeof env.JWT_REFRESH_SECRET === 'string' ? env.JWT_REFRESH_SECRET : '';
  if (access === refresh) {
    throw new Error('JWT_ACCESS_SECRET và JWT_REFRESH_SECRET phải khác nhau ở production');
  }
  for (const [name, value] of [
    ['JWT_ACCESS_SECRET', access],
    ['JWT_REFRESH_SECRET', refresh],
  ] as const) {
    if (value.toLowerCase().includes('change_me')) {
      throw new Error(`${name} vẫn là giá trị mẫu (chứa "change_me") — hãy đặt secret ngẫu nhiên`);
    }
  }
  return env;
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(4000),

  MONGODB_URI: Joi.string().required(),
  MONGODB_DB: Joi.string().default('ordergo'),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('30d'),

  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),

  /** Thư mục lưu ảnh upload (tương đối cwd hoặc tuyệt đối) */
  UPLOAD_DIR: Joi.string().default('uploads'),

  /**
   * Express `trust proxy` — để `req.ip` là IP thật của khách khi chạy sau reverse proxy (Caddy).
   * "0"/"false" (mặc định): không tin X-Forwarded-For (API mở trực tiếp ra Internet).
   * "1": tin 1 proxy đứng ngay trước (Caddy) — giá trị nên dùng khi deploy sau Caddy.
   * Số N: tin N proxy; hoặc danh sách IP/subnet/"loopback,uniquelocal". KHÔNG dùng "true" nếu
   * API có thể bị truy cập trực tiếp: khi đó client tự đặt X-Forwarded-For để né rate limit.
   */
  TRUST_PROXY: Joi.string().allow('').default('0'),

  /**
   * Swagger UI tại /api-docs. Không đặt: bật ở dev/test/staging, TẮT ở production.
   * "1" bật cả ở production; "0" tắt ở mọi môi trường.
   */
  SWAGGER_ENABLED: flag().optional(),

  /** "1" tắt rate limit (@nestjs/throttler) — chỉ dùng cho test. Khoá đăng nhập theo SĐT vẫn bật. */
  THROTTLE_DISABLED: flag().default(false),

  /**
   * Sentry (tuỳ chọn). Để trống = không gửi gì. Phải là biến môi trường thật (đọc trước khi
   * ConfigModule nạp file .env). Chỉ báo lỗi 5xx, không gửi PII (body/header/cookie/query bị xoá).
   */
  SENTRY_DSN: Joi.string().uri().allow('').default(''),
  /** Tên môi trường trên Sentry; mặc định = NODE_ENV. */
  SENTRY_ENVIRONMENT: Joi.string().allow('').default(''),
  /** Tỉ lệ lấy mẫu trace 0..1; mặc định 0 (chỉ báo lỗi). */
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0),
}).custom(assertProductionSecrets, 'production secrets');

export interface AppEnv {
  NODE_ENV: 'development' | 'staging' | 'production' | 'test';
  PORT: number;
  MONGODB_URI: string;
  MONGODB_DB: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL: string;
  JWT_REFRESH_TTL: string;
  CORS_ORIGINS: string;
  UPLOAD_DIR: string;
  TRUST_PROXY: string;
  SWAGGER_ENABLED?: boolean;
  THROTTLE_DISABLED: boolean;
  SENTRY_DSN: string;
  SENTRY_ENVIRONMENT: string;
  SENTRY_TRACES_SAMPLE_RATE: number;
}

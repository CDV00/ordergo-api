import * as Joi from 'joi';

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
});

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
}

import { envValidationSchema } from './env.validation';

const base = {
  MONGODB_URI: 'mongodb://localhost:27017',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
};

function validate(env: Record<string, string>) {
  return envValidationSchema.validate(env, { allowUnknown: true, abortEarly: false });
}

describe('envValidationSchema', () => {
  it('mặc định cho biến mới', () => {
    const { error, value } = validate(base);
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      TRUST_PROXY: '0',
      THROTTLE_DISABLED: false,
      SENTRY_DSN: '',
      SENTRY_ENVIRONMENT: '',
      SENTRY_TRACES_SAMPLE_RATE: 0,
    });
    expect(value.SWAGGER_ENABLED).toBeUndefined();
  });

  it('cờ "1"/"0" → boolean', () => {
    const { value } = validate({ ...base, THROTTLE_DISABLED: '1', SWAGGER_ENABLED: '0' });
    expect(value.THROTTLE_DISABLED).toBe(true);
    expect(value.SWAGGER_ENABLED).toBe(false);
  });

  it('production: access secret = refresh secret → lỗi', () => {
    const { error } = validate({
      ...base,
      NODE_ENV: 'production',
      JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET,
    });
    expect(error?.message).toMatch(/phải khác nhau/);
  });

  it('production: secret chứa change_me → lỗi', () => {
    const { error } = validate({
      ...base,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'dev_access_secret_change_me_to_32_plus_random_chars_xx',
    });
    expect(error?.message).toMatch(/JWT_ACCESS_SECRET.*change_me/);
  });

  it('development: cho phép secret mẫu', () => {
    const { error } = validate({
      ...base,
      JWT_ACCESS_SECRET: 'dev_access_secret_change_me_to_32_plus_random_chars_xx',
    });
    expect(error).toBeUndefined();
  });

  it('SENTRY_TRACES_SAMPLE_RATE ngoài 0..1 → lỗi', () => {
    expect(validate({ ...base, SENTRY_TRACES_SAMPLE_RATE: '2' }).error).toBeDefined();
  });
});

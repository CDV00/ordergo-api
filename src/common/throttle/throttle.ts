import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  applyDecorators,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator';

export const TOO_MANY_REQUESTS_MESSAGE = 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.';

const MINUTE_MS = 60_000;

/**
 * Hạn mức mỗi phút. Bộ đếm tách theo từng route (controller + handler) và theo tracker:
 * user đã đăng nhập → userId (nhiều máy POS/KDS sau cùng NAT không giẫm chân nhau),
 * khách ẩn danh / route @Public() → IP (cần TRUST_PROXY đúng khi chạy sau Caddy).
 */
export const RATE_LIMITS = {
  /** Mặc định cho mọi route — đủ rộng cho POS/KDS polling + thao tác. */
  default: 300,
  login: 10,
  register: 10,
  refresh: 30,
  changePassword: 5,
  /** QR công khai: quét bàn, gọi món, xác nhận OTP. */
  publicQr: 20,
  /** Gửi OTP tốn SMS → chặt hơn; OtpService còn chặn 1 OTP/SĐT/30s. */
  otpRequest: 5,
} as const;

/** Ghi đè hạn mức (số request / phút) cho một route. */
export function RateLimit(perMinute: number) {
  return applyDecorators(Throttle({ default: { limit: perMinute, ttl: MINUTE_MS } }));
}

/**
 * Storage: in-memory (đủ cho 1 instance). Chạy nhiều instance → dùng Redis để chia sẻ bộ đếm:
 *   yarn add @nest-lab/throttler-storage-redis ioredis
 *   storage: new ThrottlerStorageRedisService(new Redis(process.env.REDIS_URL))
 * (Khoá đăng nhập theo SĐT đã lưu ở Mongo nên vẫn đúng khi nhiều instance.)
 */
export const AppThrottlerModule = ThrottlerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const disabled = config.get<boolean>('THROTTLE_DISABLED') === true;
    return {
      throttlers: [{ name: 'default', ttl: MINUTE_MS, limit: RATE_LIMITS.default }],
      skipIf: () => disabled,
    };
  },
});

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /** Chỉ áp cho HTTP (Socket.IO handshake tự kiểm tra trong adapter). */
  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(context.getType() !== 'http');
  }

  /** Guard chạy sau JwtAuthGuard nên `req.user` (nếu có) đã được xác thực. */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const userId = (req as unknown as AuthenticatedRequest).user?.userId;
    if (userId) return `user:${userId}`;
    return `ip:${await super.getTracker(req)}`;
  }

  protected throwThrottlingException(): Promise<void> {
    throw new HttpException(
      { code: 'TOO_MANY_REQUESTS', message: TOO_MANY_REQUESTS_MESSAGE },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

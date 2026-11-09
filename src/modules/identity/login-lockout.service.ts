import { HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { createHash } from 'node:crypto';
import { LoginAttemptDoc } from './schemas/login-attempt.schema';
import { maskPhone } from '../../shared/utils/mask';

export const LOGIN_MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

function keyOf(phone: string): string {
  return createHash('sha256').update(`login:${phone}`).digest('hex');
}

/**
 * Khoá đăng nhập theo tài khoản: sai {@link LOGIN_MAX_FAILURES} lần trong 15 phút → khoá SĐT đó
 * 15 phút (429 ACCOUNT_LOCKED_TEMPORARILY), bất kể IP. Đăng nhập đúng → xoá bộ đếm.
 * Bổ sung cho rate limit theo IP (@nestjs/throttler) — cái đó không chặn được botnet nhiều IP.
 */
@Injectable()
export class LoginLockoutService implements OnModuleInit {
  private readonly logger = new Logger(LoginLockoutService.name);

  constructor(@InjectModel(LoginAttemptDoc.name) private readonly model: Model<LoginAttemptDoc>) {}

  /** autoIndex tắt ở production → tự tạo unique + TTL index khi khởi động. */
  async onModuleInit(): Promise<void> {
    try {
      await this.model.createIndexes();
    } catch (err) {
      this.logger.error(`createIndexes login_attempts lỗi: ${(err as Error).message}`);
    }
  }

  /** Ném 429 nếu SĐT đang bị khoá. Gọi TRƯỚC khi kiểm mật khẩu. */
  async assertNotLocked(phone: string): Promise<void> {
    const doc = await this.model
      .findOne({ key: keyOf(phone), lockedUntil: { $gt: new Date() } })
      .lean()
      .exec();
    if (doc?.lockedUntil) throw lockedException(doc.lockedUntil);
  }

  /** Ghi nhận 1 lần sai (atomic, upsert). Trả về true nếu lần này làm tài khoản bị khoá. */
  async recordFailure(phone: string): Promise<boolean> {
    const now = new Date();
    const inWindow = { $gt: ['$windowStart', new Date(now.getTime() - WINDOW_MS)] };
    const pipeline: PipelineStage[] = [
      {
        $set: {
          failures: { $cond: [inWindow, { $add: [{ $ifNull: ['$failures', 0] }, 1] }, 1] },
          windowStart: { $cond: [inWindow, '$windowStart', now] },
        },
      },
      {
        $set: {
          lockedUntil: {
            $cond: [
              { $gte: ['$failures', LOGIN_MAX_FAILURES] },
              new Date(now.getTime() + LOCK_MS),
              null,
            ],
          },
        },
      },
      {
        $set: {
          expiresAt: { $ifNull: ['$lockedUntil', { $add: ['$windowStart', WINDOW_MS] }] },
        },
      },
    ];
    const update = () =>
      this.model
        .findOneAndUpdate({ key: keyOf(phone) }, pipeline, {
          upsert: true,
          returnDocument: 'after',
          updatePipeline: true,
        })
        .lean()
        .exec();

    let doc: LoginAttemptDoc | null;
    try {
      doc = await update();
    } catch (err) {
      // Hai request đồng thời cùng upsert → E11000 ở một bên; thử lại sẽ cập nhật bản ghi đã có.
      if ((err as { code?: number }).code !== 11000) throw err;
      doc = await update();
    }

    const lockedNow = doc?.failures === LOGIN_MAX_FAILURES && doc.lockedUntil !== null;
    if (lockedNow) {
      this.logger.warn(
        `Tạm khoá đăng nhập ${maskPhone(phone)} ${LOCK_MS / 60_000} phút sau ${LOGIN_MAX_FAILURES} lần sai`,
      );
    }
    return lockedNow;
  }

  /** Đăng nhập thành công → xoá bộ đếm. */
  async reset(phone: string): Promise<void> {
    await this.model.deleteOne({ key: keyOf(phone) }).exec();
  }
}

function lockedException(until: Date): HttpException {
  const retryAfterSeconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return new HttpException(
    {
      code: 'ACCOUNT_LOCKED_TEMPORARILY',
      message: `Tài khoản tạm thời bị khoá do đăng nhập sai nhiều lần. Vui lòng thử lại sau ${minutes} phút.`,
      details: { retryAfterSeconds },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomInt } from 'node:crypto';
import { OtpAttemptDoc } from './schemas/otp-attempt.schema';
import { SMS_ADAPTER } from './sms-adapter';
import type { SmsAdapter } from './sms-adapter';
import { newId } from '../../shared/utils/uuid';

export type OtpPurpose = 'customer_claim' | 'staff_login' | 'reset_password';

const OTP_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const MIN_INTERVAL_SECONDS = 30; // không gửi quá 1 OTP/phone/30s

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function normalizePhone(p: string): string {
  let s = p.trim();
  if (s.startsWith('0')) s = '+84' + s.substring(1);
  if (!s.startsWith('+')) s = '+' + s;
  return s;
}

@Injectable()
export class OtpService {
  constructor(
    @InjectModel(OtpAttemptDoc.name) private readonly model: Model<OtpAttemptDoc>,
    @Inject(SMS_ADAPTER) private readonly sms: SmsAdapter,
  ) {}

  async request(params: {
    phone: string;
    purpose: OtpPurpose;
    ip?: string;
  }): Promise<{ phone: string; expiresAt: Date }> {
    const phone = normalizePhone(params.phone);

    // Rate limit: 1 OTP/phone/purpose/30s
    const recent = await this.model
      .findOne({
        phone,
        purpose: params.purpose,
        createdAt: { $gt: new Date(Date.now() - MIN_INTERVAL_SECONDS * 1000) },
      })
      .lean()
      .exec();
    if (recent) {
      const waitSec = Math.ceil(
        (recent.createdAt.getTime() + MIN_INTERVAL_SECONDS * 1000 - Date.now()) / 1000,
      );
      throw new BadRequestException({
        code: 'OTP_RATE_LIMIT',
        message: `Vui lòng đợi ${waitSec}s trước khi gửi lại.`,
        details: { retryAfterSeconds: waitSec },
      });
    }

    // 6-digit code
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    await this.model.create({
      id: newId(),
      phone,
      codeHash: hashCode(code),
      expiresAt,
      attempts: 0,
      consumedAt: null,
      ipAddress: params.ip ?? null,
      purpose: params.purpose,
      createdAt: new Date(),
    });

    await this.sms.send(
      phone,
      `OrderGo: Mã xác thực của bạn là ${code}. Hết hạn sau 5 phút. Không chia sẻ mã này.`,
    );

    return { phone, expiresAt };
  }

  /**
   * Verify code + consume. Trả về true nếu valid.
   * Atomic — không cho phép replay.
   */
  async verify(params: { phone: string; code: string; purpose: OtpPurpose }): Promise<boolean> {
    const phone = normalizePhone(params.phone);
    const codeHash = hashCode(params.code);

    // Tìm OTP gần nhất chưa consumed, chưa expired
    const attempt = await this.model
      .findOne({
        phone,
        purpose: params.purpose,
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .exec();

    if (!attempt) {
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message: 'Mã không đúng hoặc đã hết hạn. Vui lòng yêu cầu mã mới.',
      });
    }

    // Increment attempts atomic — chống brute force
    if (attempt.attempts >= MAX_ATTEMPTS) {
      throw new HttpException(
        {
          code: 'OTP_TOO_MANY_ATTEMPTS',
          message: 'Sai mã quá nhiều lần. Vui lòng yêu cầu mã mới.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (attempt.codeHash !== codeHash) {
      attempt.attempts += 1;
      await attempt.save();
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message: 'Mã không đúng. Vui lòng kiểm tra và thử lại.',
        details: { attemptsLeft: MAX_ATTEMPTS - attempt.attempts },
      });
    }

    // Consume
    attempt.consumedAt = new Date();
    await attempt.save();

    return true;
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'node:crypto';
import { RefreshTokenDoc } from '../schemas/refresh-token.schema';
import { newId } from '../../../shared/utils/uuid';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class RefreshTokenRepository {
  constructor(@InjectModel(RefreshTokenDoc.name) private readonly model: Model<RefreshTokenDoc>) {}

  async create(data: {
    userId: string;
    rawToken: string;
    expiresAt: Date;
    deviceInfo?: { ua?: string; ip?: string; deviceId?: string };
  }): Promise<RefreshTokenDoc> {
    const doc = await this.model.create({
      id: newId(),
      userId: data.userId,
      tokenHash: hashToken(data.rawToken),
      deviceInfo: data.deviceInfo ?? {},
      expiresAt: data.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    });
    return doc.toObject() as RefreshTokenDoc;
  }

  async findActive(rawToken: string): Promise<RefreshTokenDoc | null> {
    return this.model
      .findOne({
        tokenHash: hashToken(rawToken),
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .lean<RefreshTokenDoc>()
      .exec();
  }

  async revoke(rawToken: string): Promise<void> {
    await this.model
      .updateOne({ tokenHash: hashToken(rawToken) }, { $set: { revokedAt: new Date() } })
      .exec();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.model
      .updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
  }
}

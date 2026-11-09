import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserDoc } from '../schemas/user.schema';
import { newId } from '../../../shared/utils/uuid';

@Injectable()
export class UserRepository {
  constructor(@InjectModel(UserDoc.name) private readonly model: Model<UserDoc>) {}

  /**
   * Customer-facing: tạo user "lite" qua phone OTP — không có password.
   * passwordHash placeholder không cho login bằng password.
   */
  async createPasswordless(data: { phone: string; displayName: string }): Promise<UserDoc> {
    const now = new Date();
    const doc = await this.model.create({
      id: newId(),
      phone: data.phone,
      email: null,
      passwordHash: 'no-password-customer-passwordless',
      displayName: data.displayName,
      status: 'active',
      twoFactorEnabled: false,
      twoFactorSecret: null,
      preferredLanguage: 'vi',
      phoneVerifiedAt: now,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return doc.toObject() as UserDoc;
  }

  async create(data: {
    phone: string;
    email?: string | null;
    passwordHash: string;
    displayName: string;
  }): Promise<UserDoc> {
    const now = new Date();
    const doc = await this.model.create({
      id: newId(),
      phone: data.phone,
      email: data.email ?? null,
      passwordHash: data.passwordHash,
      displayName: data.displayName,
      status: 'active',
      twoFactorEnabled: false,
      twoFactorSecret: null,
      preferredLanguage: 'vi',
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return doc.toObject() as UserDoc;
  }

  async findByPhone(phone: string): Promise<UserDoc | null> {
    return this.model.findOne({ phone, deletedAt: null }).lean<UserDoc>().exec();
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.model.updateOne({ id }, { $set: { passwordHash, updatedAt: new Date() } }).exec();
  }

  async findById(id: string): Promise<UserDoc | null> {
    return this.model.findOne({ id, deletedAt: null }).lean<UserDoc>().exec();
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.model
      .updateOne({ id }, { $set: { lastLoginAt: new Date(), updatedAt: new Date() } })
      .exec();
  }
}

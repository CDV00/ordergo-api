import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CustomerDoc } from '../schemas/customer.schema';
import { newId } from '../../../shared/utils/uuid';

@Injectable()
export class CustomerRepository {
  constructor(@InjectModel(CustomerDoc.name) private readonly model: Model<CustomerDoc>) {}

  async findById(id: string): Promise<CustomerDoc | null> {
    return this.model.findOne({ id, deletedAt: null }).lean<CustomerDoc>().exec();
  }

  async findByCookieAnchor(tenantId: string, cookieAnchor: string): Promise<CustomerDoc | null> {
    return this.model
      .findOne({ tenantId, cookieAnchor, deletedAt: null })
      .lean<CustomerDoc>()
      .exec();
  }

  async findByPhone(tenantId: string, phone: string): Promise<CustomerDoc | null> {
    return this.model.findOne({ tenantId, phone, deletedAt: null }).lean<CustomerDoc>().exec();
  }

  async createAnonymous(data: {
    tenantId: string;
    cookieAnchor: string;
    deviceFingerprint?: string;
  }): Promise<CustomerDoc> {
    const now = new Date();
    const doc = await this.model.create({
      id: newId(),
      tenantId: data.tenantId,
      status: 'anonymous',
      userId: null,
      cookieAnchor: data.cookieAnchor,
      phone: null,
      name: null,
      email: null,
      birthday: null,
      deviceFingerprints: data.deviceFingerprint ? [data.deviceFingerprint] : [],
      stats: {
        totalSpent: { amount: 0, currency: 'VND' },
        orderCount: 0,
        firstOrderAt: null,
        lastOrderAt: null,
      },
      tags: [],
      consents: {
        marketing: { granted: false, grantedAt: null },
        crossTenantShare: { granted: false, grantedAt: null },
        privacyPolicyAcceptedAt: now, // implicit khi scan
      },
      dataErasureRequestedAt: null,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return doc.toObject() as CustomerDoc;
  }

  /**
   * Upgrade anonymous customer (cookie-based) → verified (phone-linked).
   * - Nếu phone CHƯA có customer trong tenant → upgrade in-place
   * - Nếu phone ĐÃ có customer (returning) → merge stats, soft delete anonymous
   */
  async claimWithPhone(params: {
    anonymousId: string;
    tenantId: string;
    phone: string;
    userId: string;
    name?: string;
  }): Promise<{ customerId: string; merged: boolean }> {
    const existing = await this.findByPhone(params.tenantId, params.phone);
    const anonymous = await this.findById(params.anonymousId);
    if (!anonymous) {
      throw new Error(`Anonymous customer ${params.anonymousId} not found`);
    }

    const now = new Date();

    if (existing && existing.id !== anonymous.id) {
      await this.model
        .updateOne(
          { id: existing.id },
          {
            $inc: {
              'stats.totalSpent.amount': anonymous.stats.totalSpent.amount,
              'stats.orderCount': anonymous.stats.orderCount,
            },
            $set: {
              'stats.lastOrderAt': anonymous.stats.lastOrderAt ?? existing.stats.lastOrderAt,
              userId: params.userId,
              status: 'verified',
              name: params.name ?? existing.name,
              updatedAt: now,
            },
          },
        )
        .exec();
      await this.model
        .updateOne({ id: anonymous.id }, { $set: { deletedAt: now, updatedAt: now } })
        .exec();
      return { customerId: existing.id, merged: true };
    }

    await this.model
      .updateOne(
        { id: anonymous.id },
        {
          $set: {
            status: 'verified',
            userId: params.userId,
            phone: params.phone,
            name: params.name ?? anonymous.name,
            updatedAt: now,
          },
        },
      )
      .exec();
    return { customerId: anonymous.id, merged: false };
  }

  async recordOrder(id: string, orderTotal: number): Promise<void> {
    const now = new Date();
    await this.model
      .updateOne(
        { id },
        {
          $inc: {
            'stats.totalSpent.amount': orderTotal,
            'stats.orderCount': 1,
          },
          $set: {
            'stats.lastOrderAt': now,
            updatedAt: now,
          },
          $setOnInsert: { 'stats.firstOrderAt': now },
        },
        { upsert: false },
      )
      .exec();

    // Set firstOrderAt nếu null (manual vì $setOnInsert chỉ work với upsert)
    await this.model
      .updateOne({ id, 'stats.firstOrderAt': null }, { $set: { 'stats.firstOrderAt': now } })
      .exec();
  }
}

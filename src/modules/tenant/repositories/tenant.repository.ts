import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TenantDoc } from '../schemas/tenant.schema';
import { newId } from '../../../shared/utils/uuid';

@Injectable()
export class TenantRepository {
  constructor(@InjectModel(TenantDoc.name) private readonly model: Model<TenantDoc>) {}

  async create(data: {
    name: string;
    legalName?: string | null;
    taxCode?: string | null;
    ownerUserId: string;
  }): Promise<TenantDoc> {
    const now = new Date();
    const doc = await this.model.create({
      id: newId(),
      name: data.name,
      legalName: data.legalName ?? null,
      taxCode: data.taxCode ?? null,
      ownerUserId: data.ownerUserId,
      status: 'active',
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return doc.toObject() as TenantDoc;
  }

  async findById(id: string): Promise<TenantDoc | null> {
    return this.model.findOne({ id, deletedAt: null }).lean<TenantDoc>().exec();
  }

  async findByOwner(ownerUserId: string): Promise<TenantDoc[]> {
    return this.model
      .find({ ownerUserId, deletedAt: null })
      .lean<TenantDoc[]>()
      .exec();
  }
}

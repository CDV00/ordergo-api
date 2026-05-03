import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MembershipDoc, RoleCode, ROLE_PERMISSIONS } from '../schemas/membership.schema';
import { newId } from '../../../shared/utils/uuid';

@Injectable()
export class MembershipRepository {
  constructor(@InjectModel(MembershipDoc.name) private readonly model: Model<MembershipDoc>) {}

  async create(data: {
    tenantId: string;
    userId: string;
    venueId?: string | null;
    roleCode: RoleCode;
    permissions?: string[];
    invitedBy?: string | null;
    status?: 'pending' | 'active';
  }): Promise<MembershipDoc> {
    const now = new Date();
    const permissions = data.permissions ?? ROLE_PERMISSIONS[data.roleCode];
    const doc = await this.model.create({
      id: newId(),
      tenantId: data.tenantId,
      userId: data.userId,
      venueId: data.venueId ?? null,
      roleCode: data.roleCode,
      permissions,
      invitedBy: data.invitedBy ?? null,
      invitedAt: now,
      acceptedAt: data.status === 'pending' ? null : now,
      status: data.status ?? 'active',
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return doc.toObject() as MembershipDoc;
  }

  async findActiveByUser(userId: string): Promise<MembershipDoc[]> {
    return this.model
      .find({ userId, status: 'active', deletedAt: null })
      .lean<MembershipDoc[]>()
      .exec();
  }

  async findByUserAndTenant(userId: string, tenantId: string): Promise<MembershipDoc | null> {
    return this.model
      .findOne({ userId, tenantId, status: 'active', deletedAt: null })
      .lean<MembershipDoc>()
      .exec();
  }

  async findByTenant(tenantId: string): Promise<MembershipDoc[]> {
    return this.model.find({ tenantId, deletedAt: null }).lean<MembershipDoc[]>().exec();
  }
}

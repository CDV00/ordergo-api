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

  /**
   * Đồng bộ permissions của membership theo ROLE_PERMISSIONS hiện tại (trừ role `custom`).
   * Permissions được chép vào từng membership lúc tạo, nên khi bảng quyền đổi phải chạy lại.
   */
  async syncRolePermissions(): Promise<number> {
    let changed = 0;
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS) as Array<
      [RoleCode, string[]]
    >) {
      if (role === 'custom') continue;
      const res = await this.model
        .updateMany(
          { roleCode: role, deletedAt: null, permissions: { $ne: permissions } },
          { $set: { permissions, updatedAt: new Date() } },
        )
        .exec();
      changed += res.modifiedCount;
    }
    return changed;
  }

  async findInTenant(tenantId: string, id: string): Promise<MembershipDoc | null> {
    return this.model.findOne({ id, tenantId, deletedAt: null }).lean<MembershipDoc>().exec();
  }

  /** Membership bất kỳ trạng thái của user ở đúng tenant + venue (để chặn mời trùng). */
  async findExisting(
    tenantId: string,
    userId: string,
    venueId: string | null,
  ): Promise<MembershipDoc | null> {
    return this.model
      .findOne({ tenantId, userId, venueId, deletedAt: null })
      .lean<MembershipDoc>()
      .exec();
  }

  async updateInTenant(
    tenantId: string,
    id: string,
    set: Partial<Pick<MembershipDoc, 'roleCode' | 'permissions' | 'status' | 'venueId'>>,
  ): Promise<MembershipDoc | null> {
    return this.model
      .findOneAndUpdate(
        { id, tenantId, deletedAt: null },
        { $set: { ...set, updatedAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean<MembershipDoc>()
      .exec();
  }
}

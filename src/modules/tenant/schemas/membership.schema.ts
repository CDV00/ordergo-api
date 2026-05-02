import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoleCode =
  | 'owner'
  | 'tenant_admin'
  | 'venue_manager'
  | 'cashier'
  | 'server'
  | 'kitchen'
  | 'receptionist'
  | 'housekeeping'
  | 'accountant'
  | 'custom';

export type MembershipStatus = 'pending' | 'active' | 'revoked';

/**
 * Permission tập hợp theo role chuẩn. Custom role tự override.
 */
export const ROLE_PERMISSIONS: Record<RoleCode, string[]> = {
  owner: ['*'],
  tenant_admin: ['*'],
  venue_manager: [
    'venue.manage',
    'menu.manage',
    'table.manage',
    'order.manage',
    'order.cancel',
    'order.refund',
    'report.view',
    'staff.invite',
    'shift.manage',
  ],
  cashier: ['order.create', 'order.update', 'order.pay', 'shift.open', 'shift.close'],
  server: ['order.create', 'order.update', 'order.send_to_kitchen', 'table.update_status'],
  kitchen: ['order.view', 'order.update_kitchen_status'],
  receptionist: ['booking.manage', 'order.create', 'guest.manage'],
  housekeeping: ['room.update_status'],
  accountant: ['report.view', 'report.export', 'einvoice.view'],
  custom: [],
};

@Schema({ collection: 'memberships' })
export class MembershipDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, required: true, index: true })
  userId!: string;

  /** null = scope toàn tenant (Owner, TenantAdmin, Accountant); string = bound venue */
  @Prop({ type: String, default: null, index: true })
  venueId!: string | null;

  @Prop({
    type: String,
    enum: [
      'owner',
      'tenant_admin',
      'venue_manager',
      'cashier',
      'server',
      'kitchen',
      'receptionist',
      'housekeeping',
      'accountant',
      'custom',
    ],
    required: true,
  })
  roleCode!: RoleCode;

  @Prop({ type: [String], default: [] })
  permissions!: string[];

  @Prop({ type: String, default: null })
  invitedBy!: string | null;

  @Prop({ type: Date, default: () => new Date() })
  invitedAt!: Date;

  @Prop({ type: Date, default: null })
  acceptedAt!: Date | null;

  @Prop({
    type: String,
    enum: ['pending', 'active', 'revoked'],
    default: 'active',
    index: true,
  })
  status!: MembershipStatus;

  @Prop({ type: Number, default: 1 })
  schemaVersion!: number;

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;

  @Prop({ type: Date, default: () => new Date() })
  updatedAt!: Date;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;
}

export type MembershipDocument = HydratedDocument<MembershipDoc>;
export const MembershipSchema = SchemaFactory.createForClass(MembershipDoc);

MembershipSchema.index({ tenantId: 1, userId: 1, venueId: 1 }, { unique: true });
MembershipSchema.index({ userId: 1, status: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlanCode = 'free' | 'starter' | 'pro' | 'business' | 'enterprise';
export type TenantStatus = 'active' | 'suspended' | 'cancelled';

@Schema({ _id: false })
class TenantPlan {
  @Prop({ type: String, default: 'free' })
  code!: PlanCode;

  @Prop({ type: [String], default: ['identity', 'tenant', 'catalog', 'table', 'order'] })
  enabledModules!: string[];

  @Prop({ type: Number, default: 5 })
  seatLimit!: number;

  @Prop({ type: Number, default: 1 })
  venueLimit!: number;

  @Prop({ type: Date, default: null })
  trialEndsAt!: Date | null;
}

@Schema({ collection: 'tenants' })
export class TenantDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, default: null })
  legalName!: string | null;

  @Prop({ type: String, default: null, index: true, sparse: true })
  taxCode!: string | null;

  @Prop({ type: String, required: true, index: true })
  ownerUserId!: string;

  @Prop({ type: TenantPlan, default: () => ({}) })
  plan!: TenantPlan;

  @Prop({ type: String, enum: ['active', 'suspended', 'cancelled'], default: 'active', index: true })
  status!: TenantStatus;

  @Prop({
    type: {
      defaultCurrency: { type: String, default: 'VND' },
      defaultTimezone: { type: String, default: 'Asia/Ho_Chi_Minh' },
    },
    default: () => ({}),
    _id: false,
  })
  preferences!: { defaultCurrency: string; defaultTimezone: string };

  @Prop({ type: Number, default: 1 })
  schemaVersion!: number;

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;

  @Prop({ type: Date, default: () => new Date() })
  updatedAt!: Date;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;
}

export type TenantDocument = HydratedDocument<TenantDoc>;
export const TenantSchema = SchemaFactory.createForClass(TenantDoc);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CustomerStatus = 'anonymous' | 'verified' | 'full';

const MoneyShape = {
  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'VND' },
};

const StatsShape = {
  totalSpent: { type: MoneyShape, default: () => ({ amount: 0, currency: 'VND' }) },
  orderCount: { type: Number, default: 0 },
  firstOrderAt: { type: Date, default: null },
  lastOrderAt: { type: Date, default: null },
};

const ConsentsShape = {
  marketing: {
    granted: { type: Boolean, default: false },
    grantedAt: { type: Date, default: null },
  },
  crossTenantShare: {
    granted: { type: Boolean, default: false },
    grantedAt: { type: Date, default: null },
  },
  privacyPolicyAcceptedAt: { type: Date, default: null },
};

@Schema({ collection: 'customers' })
export class CustomerDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({
    type: String,
    enum: ['anonymous', 'verified', 'full'],
    default: 'anonymous',
    index: true,
  })
  status!: CustomerStatus;

  /** Link tới User toàn cục — null nếu anonymous */
  @Prop({ type: String, default: null, index: true })
  userId!: string | null;

  /** Token gắn cookie cho anonymous customer — UUID */
  @Prop({ type: String, default: null, index: true, sparse: true })
  cookieAnchor!: string | null;

  /** Phone denormalize từ User cho query nhanh — null khi anonymous */
  @Prop({ type: String, default: null, index: true, sparse: true })
  phone!: string | null;

  @Prop({ type: String, default: null })
  name!: string | null;

  @Prop({ type: String, default: null })
  email!: string | null;

  @Prop({ type: Date, default: null })
  birthday!: Date | null;

  @Prop({ type: [String], default: [] })
  deviceFingerprints!: string[];

  @Prop({ type: StatsShape, default: () => ({}), _id: false })
  stats!: {
    totalSpent: { amount: number; currency: string };
    orderCount: number;
    firstOrderAt: Date | null;
    lastOrderAt: Date | null;
  };

  @Prop({ type: [String], default: [] })
  tags!: string[];

  /** Ghi chú nội bộ của quán (nhân viên nhập) — xoá khi ẩn danh hoá */
  @Prop({ type: String, default: null })
  note!: string | null;

  @Prop({ type: ConsentsShape, default: () => ({}), _id: false })
  consents!: {
    marketing: { granted: boolean; grantedAt: Date | null };
    crossTenantShare: { granted: boolean; grantedAt: Date | null };
    privacyPolicyAcceptedAt: Date | null;
  };

  // PDPL — right to erase
  @Prop({ type: Date, default: null })
  dataErasureRequestedAt!: Date | null;

  @Prop({ type: Number, default: 1 })
  schemaVersion!: number;

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;

  @Prop({ type: Date, default: () => new Date() })
  updatedAt!: Date;

  @Prop({ type: String, default: null })
  createdBy!: string | null;

  @Prop({ type: String, default: null })
  updatedBy!: string | null;

  @Prop({ type: Date, default: null, index: true })
  deletedAt!: Date | null;
}

export type CustomerDocument = HydratedDocument<CustomerDoc>;
export const CustomerSchema = SchemaFactory.createForClass(CustomerDoc);

// Unique chỉ khi field có giá trị. `sparse` KHÔNG dùng được cho index ghép (tenantId luôn có
// mặt nên doc phone=null vẫn vào index) → khách vô danh thứ 2 của 1 quán bị lỗi duplicate key.
const whenString = (field: string) => ({
  unique: true,
  partialFilterExpression: { [field]: { $type: 'string' } },
});
CustomerSchema.index({ tenantId: 1, phone: 1 }, { ...whenString('phone'), name: 'uniq_phone' });
CustomerSchema.index(
  { tenantId: 1, cookieAnchor: 1 },
  { ...whenString('cookieAnchor'), name: 'uniq_cookie_anchor' },
);
CustomerSchema.index({ tenantId: 1, userId: 1 }, { ...whenString('userId'), name: 'uniq_user' });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PaymentMethod =
  | 'cash'
  | 'vietqr'
  | 'momo'
  | 'vnpay'
  | 'zalopay'
  | 'card'
  | 'bank_transfer';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';

const MoneyShape = {
  amount: { type: Number, required: true },
  currency: { type: String, default: 'VND' },
};

const RefundShape = {
  id: { type: String, required: true },
  amount: { type: MoneyShape, required: true, _id: false },
  reason: { type: String, default: null },
  refundedAt: { type: Date, required: true },
  refundedBy: { type: String, required: true },
};

@Schema({ collection: 'payments' })
export class PaymentDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, required: true, index: true })
  venueId!: string;

  @Prop({ type: String, required: true, index: true })
  orderId!: string;

  @Prop({ type: String, required: true })
  orderNumber!: string;

  @Prop({
    type: String,
    enum: ['cash', 'vietqr', 'momo', 'vnpay', 'zalopay', 'card', 'bank_transfer'],
    required: true,
  })
  method!: PaymentMethod;

  @Prop({ type: MoneyShape, required: true, _id: false })
  amount!: { amount: number; currency: string };

  @Prop({ type: Date, required: true, index: true })
  receivedAt!: Date;

  @Prop({ type: String, required: true })
  receivedBy!: string;

  @Prop({ type: String, default: null })
  shiftId!: string | null;

  @Prop({ type: String, default: null, index: true, sparse: true })
  externalRef!: string | null;

  @Prop({
    type: String,
    enum: ['pending', 'succeeded', 'failed', 'refunded', 'partially_refunded'],
    default: 'succeeded',
    index: true,
  })
  status!: PaymentStatus;

  @Prop({ type: String, default: null })
  failureReason!: string | null;

  @Prop({
    type: MoneyShape,
    default: () => ({ amount: 0, currency: 'VND' }),
    _id: false,
  })
  refundedAmount!: { amount: number; currency: string };

  @Prop({ type: [RefundShape], default: [] })
  refunds!: Array<{
    id: string;
    amount: { amount: number; currency: string };
    reason: string | null;
    refundedAt: Date;
    refundedBy: string;
  }>;

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

export type PaymentDocument = HydratedDocument<PaymentDoc>;
export const PaymentSchema = SchemaFactory.createForClass(PaymentDoc);

PaymentSchema.index({ tenantId: 1, orderId: 1 });
PaymentSchema.index({ tenantId: 1, venueId: 1, receivedAt: -1 });

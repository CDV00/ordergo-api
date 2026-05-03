import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LoyaltyTxType = 'earn' | 'redeem' | 'adjust' | 'expire';

@Schema({ collection: 'loyalty_transactions' })
export class LoyaltyTxDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, required: true, index: true })
  cardId!: string;

  @Prop({ type: String, required: true, index: true })
  customerId!: string;

  @Prop({
    type: String,
    enum: ['earn', 'redeem', 'adjust', 'expire'],
    required: true,
  })
  type!: LoyaltyTxType;

  /** Điểm thay đổi: + cho earn/adjust, - cho redeem/expire */
  @Prop({ type: Number, required: true })
  points!: number;

  @Prop({ type: String, required: true })
  reason!: string;

  @Prop({
    type: String,
    enum: ['order', 'manual', 'system'],
    default: 'system',
  })
  referenceType!: 'order' | 'manual' | 'system';

  @Prop({ type: String, default: null })
  referenceId!: string | null;

  /** Số dư sau giao dịch — snapshot cho audit */
  @Prop({ type: Number, required: true })
  balanceAfter!: number;

  @Prop({ type: Date, default: () => new Date(), index: true })
  createdAt!: Date;

  @Prop({ type: String, default: null })
  createdBy!: string | null;
}

export type LoyaltyTxDocument = HydratedDocument<LoyaltyTxDoc>;
export const LoyaltyTxSchema = SchemaFactory.createForClass(LoyaltyTxDoc);

LoyaltyTxSchema.index({ tenantId: 1, cardId: 1, createdAt: -1 });
LoyaltyTxSchema.index({ tenantId: 1, customerId: 1, createdAt: -1 });
LoyaltyTxSchema.index({ referenceType: 1, referenceId: 1 });

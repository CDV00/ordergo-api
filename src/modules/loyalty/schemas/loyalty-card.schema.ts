import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export const TIER_THRESHOLDS: Record<LoyaltyTier, number> = {
  bronze: 0,
  silver: 1_000_000, // 1tr lifetime
  gold: 5_000_000, // 5tr
  platinum: 20_000_000, // 20tr
};

export function tierFromLifetimeSpent(spent: number): LoyaltyTier {
  if (spent >= TIER_THRESHOLDS.platinum) return 'platinum';
  if (spent >= TIER_THRESHOLDS.gold) return 'gold';
  if (spent >= TIER_THRESHOLDS.silver) return 'silver';
  return 'bronze';
}

@Schema({ collection: 'loyalty_cards' })
export class LoyaltyCardDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, required: true, index: true })
  customerId!: string;

  @Prop({ type: String, required: true, unique: true })
  cardNumber!: string;

  @Prop({
    type: String,
    enum: ['bronze', 'silver', 'gold', 'platinum'],
    default: 'bronze',
  })
  tier!: LoyaltyTier;

  /** Điểm hiện có (sau redeem) */
  @Prop({ type: Number, default: 0 })
  points!: number;

  /** Tổng điểm lifetime (chỉ tăng) — dùng tính tier */
  @Prop({ type: Number, default: 0 })
  pointsLifetime!: number;

  /** Tổng tiêu lifetime — driver chính cho tier */
  @Prop({ type: Number, default: 0 })
  spentLifetime!: number;

  @Prop({ type: Date, default: () => new Date() })
  issuedAt!: Date;

  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;

  @Prop({ type: Number, default: 1 })
  schemaVersion!: number;

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;

  @Prop({ type: Date, default: () => new Date() })
  updatedAt!: Date;

  @Prop({ type: Date, default: null, index: true })
  deletedAt!: Date | null;
}

export type LoyaltyCardDocument = HydratedDocument<LoyaltyCardDoc>;
export const LoyaltyCardSchema = SchemaFactory.createForClass(LoyaltyCardDoc);

LoyaltyCardSchema.index({ tenantId: 1, customerId: 1 }, { unique: true });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { PaymentMethod } from '../../payment/schemas/payment.schema';

export type ShiftStatus = 'open' | 'closed';

/** Tổng hợp của ca (chụp lại lúc đóng ca; ca đang mở thì tính trực tiếp). Tiền = số nguyên VND. */
export interface ShiftSummary {
  /** Tiền đã thu theo phương thức (gộp, chưa trừ hoàn tiền). */
  byMethod: Array<{ method: PaymentMethod; count: number; amount: number }>;
  /** Tổng đã thu (mọi phương thức, chưa trừ hoàn tiền). */
  totalReceived: number;
  paymentCount: number;
  /** Số đơn có ít nhất 1 khoản thu trong ca. */
  paidOrderCount: number;
  cashReceived: number;
  /** Tiền mặt hoàn cho khách trong khoảng thời gian của ca. */
  cashRefunds: number;
  /** Tổng hoàn tiền mọi phương thức trong ca. */
  refundTotal: number;
  refundCount: number;
}

const SummaryShape = {
  byMethod: {
    type: [{ method: String, count: Number, amount: Number, _id: false }],
    default: [],
  },
  totalReceived: { type: Number, default: 0 },
  paymentCount: { type: Number, default: 0 },
  paidOrderCount: { type: Number, default: 0 },
  cashReceived: { type: Number, default: 0 },
  cashRefunds: { type: Number, default: 0 },
  refundTotal: { type: Number, default: 0 },
  refundCount: { type: Number, default: 0 },
};

@Schema({ collection: 'shifts' })
export class ShiftDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, required: true, index: true })
  venueId!: string;

  @Prop({ type: String, enum: ['open', 'closed'], required: true, default: 'open' })
  status!: ShiftStatus;

  @Prop({ type: String, required: true })
  openedBy!: string;

  @Prop({ type: Date, required: true })
  openedAt!: Date;

  /** Tiền mặt đầu ca (VND, ≥ 0). */
  @Prop({ type: Number, required: true, min: 0 })
  openingCash!: number;

  @Prop({ type: String, default: null })
  closedBy!: string | null;

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  /** Tiền mặt đếm thực tế lúc đóng ca. */
  @Prop({ type: Number, default: null })
  countedCash!: number | null;

  /** = openingCash + tiền mặt thu trong ca − tiền mặt hoàn trong ca. */
  @Prop({ type: Number, default: null })
  expectedCash!: number | null;

  /** = countedCash − expectedCash (âm = thiếu, dương = thừa). */
  @Prop({ type: Number, default: null })
  difference!: number | null;

  @Prop({ type: String, default: null })
  note!: string | null;

  @Prop({ type: SummaryShape, default: null, _id: false })
  summary!: ShiftSummary | null;

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

export type ShiftDocument = HydratedDocument<ShiftDoc>;
export const ShiftSchema = SchemaFactory.createForClass(ShiftDoc);

// Mỗi cơ sở chỉ có tối đa 1 ca đang mở.
ShiftSchema.index(
  { tenantId: 1, venueId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' }, name: 'uniq_open_shift_per_venue' },
);
ShiftSchema.index({ tenantId: 1, venueId: 1, openedAt: -1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TableSessionStatus = 'open' | 'paying' | 'closed';
export type SessionOpenSource = 'qr_scan' | 'staff' | 'reservation';

const MoneyShape = {
  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'VND' },
};

@Schema({ collection: 'table_sessions' })
export class TableSessionDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, required: true, index: true })
  venueId!: string;

  @Prop({ type: String, required: true, index: true })
  tableId!: string;

  @Prop({ type: String, required: true })
  tableName!: string; // snapshot — không cần populate cross-module

  @Prop({
    type: String,
    enum: ['open', 'paying', 'closed'],
    default: 'open',
    index: true,
  })
  status!: TableSessionStatus;

  @Prop({
    type: String,
    enum: ['qr_scan', 'staff', 'reservation'],
    default: 'qr_scan',
  })
  openedBy!: SessionOpenSource;

  @Prop({ type: Date, default: () => new Date() })
  openedAt!: Date;

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  @Prop({ type: Date, required: true, index: true })
  expiresAt!: Date; // hard TTL — worker đóng

  @Prop({ type: Date, default: () => new Date(), index: true })
  lastActivityAt!: Date;

  @Prop({ type: String, default: null })
  joinCode!: string | null; // 4-6 digit, optional dùng khi staff bật

  // Customer + order tích luỹ trong session
  @Prop({ type: [String], default: [] })
  customerIds!: string[];

  @Prop({ type: [String], default: [] })
  orderIds!: string[];

  @Prop({ type: Number, default: 0 })
  orderCount!: number;

  @Prop({ type: MoneyShape, default: () => ({ amount: 0, currency: 'VND' }), _id: false })
  totalAmount!: { amount: number; currency: string };

  @Prop({ type: MoneyShape, default: () => ({ amount: 0, currency: 'VND' }), _id: false })
  paidAmount!: { amount: number; currency: string };

  // Anti-abuse signals
  @Prop({
    type: {
      firstScanIp: { type: String, default: null },
      firstScanUserAgent: { type: String, default: null },
      deviceFingerprints: { type: [String], default: [] },
    },
    default: () => ({}),
    _id: false,
  })
  metadata!: {
    firstScanIp: string | null;
    firstScanUserAgent: string | null;
    deviceFingerprints: string[];
  };

  @Prop({ type: Number, default: 1 })
  schemaVersion!: number;

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;

  @Prop({ type: Date, default: () => new Date() })
  updatedAt!: Date;

  @Prop({ type: Date, default: null, index: true })
  deletedAt!: Date | null;
}

export type TableSessionDocument = HydratedDocument<TableSessionDoc>;
export const TableSessionSchema = SchemaFactory.createForClass(TableSessionDoc);

// Find active session for table — most-used query
TableSessionSchema.index(
  { tenantId: 1, venueId: 1, tableId: 1, status: 1 },
  { partialFilterExpression: { status: 'open' } },
);
TableSessionSchema.index({ status: 1, expiresAt: 1 }); // TTL worker
TableSessionSchema.index({ status: 1, lastActivityAt: 1 }); // idle detection

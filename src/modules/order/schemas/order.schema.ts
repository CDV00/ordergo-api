import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OrderStatus =
  | 'draft'
  | 'sent'
  | 'in_progress'
  | 'ready'
  | 'served'
  | 'paid'
  | 'refunded'
  | 'cancelled';

export type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'online' | 'room_service';

export type BusinessContext = 'fnb' | 'hotel' | 'spa' | 'gym' | 'edu';

const MoneyShape = {
  amount: { type: Number, required: true },
  currency: { type: String, default: 'VND' },
};

const ProductSnapshotShape = {
  name: { type: String, required: true },
  sku: { type: String, default: null },
  imageUrl: { type: String, default: null },
};

const ModifierShape = {
  groupId: { type: String, required: true },
  groupName: { type: String, required: true },
  optionId: { type: String, required: true },
  optionName: { type: String, required: true },
  priceModifier: { type: MoneyShape, required: true, _id: false },
};

const VariantSnapshotShape = {
  name: { type: String },
  priceModifier: { type: MoneyShape, _id: false },
};

const OrderLineShape = {
  id: { type: String, required: true },
  productType: { type: String, required: true },
  productId: { type: String, required: true },
  productSnapshot: { type: ProductSnapshotShape, required: true, _id: false },
  variantId: { type: String, default: null },
  variantSnapshot: { type: VariantSnapshotShape, default: null, _id: false },
  modifiers: { type: [ModifierShape], default: [] },
  quantity: { type: Number, required: true },
  unitPrice: { type: MoneyShape, required: true, _id: false },
  lineSubtotal: { type: MoneyShape, required: true, _id: false },
  discount: { type: MoneyShape, default: () => ({ amount: 0, currency: 'VND' }), _id: false },
  lineTotal: { type: MoneyShape, required: true, _id: false },
  note: { type: String, default: null },
  kitchenStatus: {
    type: String,
    enum: ['queued', 'preparing', 'ready', 'served', 'cancelled'],
    default: 'queued',
  },
  sentToKitchenAt: { type: Date, default: null },
  readyAt: { type: Date, default: null },
  servedAt: { type: Date, default: null },
};

const PricingShape = {
  subtotal: { type: MoneyShape, required: true, _id: false },
  discount: { type: MoneyShape, default: () => ({ amount: 0, currency: 'VND' }), _id: false },
  serviceCharge: { type: MoneyShape, default: () => ({ amount: 0, currency: 'VND' }), _id: false },
  tax: { type: MoneyShape, default: () => ({ amount: 0, currency: 'VND' }), _id: false },
  total: { type: MoneyShape, required: true, _id: false },
};

interface OrderLine {
  id: string;
  productType: string;
  productId: string;
  productSnapshot: { name: string; sku: string | null; imageUrl: string | null };
  variantId: string | null;
  variantSnapshot: { name: string; priceModifier: { amount: number; currency: string } } | null;
  modifiers: Array<{
    groupId: string;
    groupName: string;
    optionId: string;
    optionName: string;
    priceModifier: { amount: number; currency: string };
  }>;
  quantity: number;
  unitPrice: { amount: number; currency: string };
  lineSubtotal: { amount: number; currency: string };
  discount: { amount: number; currency: string };
  lineTotal: { amount: number; currency: string };
  note: string | null;
  kitchenStatus: 'queued' | 'preparing' | 'ready' | 'served' | 'cancelled';
  sentToKitchenAt: Date | null;
  readyAt: Date | null;
  servedAt: Date | null;
}

@Schema({ collection: 'orders' })
export class OrderDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, required: true, index: true })
  venueId!: string;

  @Prop({ type: String, required: true, index: true })
  orderNumber!: string;

  @Prop({
    type: String,
    enum: ['dine_in', 'takeaway', 'delivery', 'online', 'room_service'],
    required: true,
  })
  orderType!: OrderType;

  @Prop({ type: String, enum: ['fnb', 'hotel', 'spa', 'gym', 'edu'], default: 'fnb' })
  businessContext!: BusinessContext;

  @Prop({ type: String, default: null, index: true })
  customerId!: string | null;

  @Prop({
    type: { name: { type: String }, phone: { type: String } },
    default: null,
    _id: false,
  })
  customerSnapshot!: { name: string; phone: string } | null;

  @Prop({ type: String, default: null, index: true })
  tableId!: string | null;

  @Prop({ type: String, default: null })
  tableName!: string | null;

  @Prop({ type: [OrderLineShape], default: [] })
  lines!: OrderLine[];

  @Prop({ type: PricingShape, required: true, _id: false })
  pricing!: {
    subtotal: { amount: number; currency: string };
    discount: { amount: number; currency: string };
    serviceCharge: { amount: number; currency: string };
    tax: { amount: number; currency: string };
    total: { amount: number; currency: string };
  };

  @Prop({
    type: String,
    enum: ['draft', 'sent', 'in_progress', 'ready', 'served', 'paid', 'refunded', 'cancelled'],
    default: 'draft',
    index: true,
  })
  status!: OrderStatus;

  // Mixed: field con tên `type` sẽ bị Mongoose hiểu là khai báo kiểu nếu khai báo shape. DTO đã validate.
  @Prop({ type: Object, default: null })
  discountInfo!: { type: 'percent' | 'amount'; value: number; reason: string | null } | null;

  @Prop({ type: String, default: null })
  cancelReason!: string | null;

  @Prop({ type: Date, default: null }) sentAt!: Date | null;
  @Prop({ type: Date, default: null }) paidAt!: Date | null;
  @Prop({ type: Date, default: null }) cancelledAt!: Date | null;

  @Prop({
    type: String,
    enum: ['pos', 'qr_menu', 'online', 'third_party', 'phone'],
    default: 'pos',
  })
  source!: 'pos' | 'qr_menu' | 'online' | 'third_party' | 'phone';

  @Prop({ type: String, default: null, index: true, sparse: true })
  clientId!: string | null;

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

export type OrderDocument = HydratedDocument<OrderDoc>;
export const OrderSchema = SchemaFactory.createForClass(OrderDoc);

OrderSchema.index({ tenantId: 1, venueId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, venueId: 1, orderNumber: 1 }, { unique: true });
OrderSchema.index({ tenantId: 1, tableId: 1, status: 1 }, { sparse: true });

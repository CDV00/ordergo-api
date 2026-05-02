import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Outbox cho Order — sự kiện publish cross-module.
 * Worker sẽ poll {publishedAt:null} và đẩy lên broker.
 */
@Schema({ collection: 'order_events' })
export class OrderEventDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, required: true })
  eventType!: string;

  @Prop({ type: String, default: 'Order' })
  aggregateType!: string;

  @Prop({ type: String, required: true, index: true })
  aggregateId!: string;

  @Prop({ type: Object, default: {} })
  payload!: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  @Prop({ type: Date, default: () => new Date(), index: true })
  occurredAt!: Date;

  @Prop({ type: Date, default: null, index: true })
  publishedAt!: Date | null;

  @Prop({ type: Number, default: 0 })
  attempts!: number;

  @Prop({ type: String, default: null })
  lastError!: string | null;
}

export type OrderEventDocument = HydratedDocument<OrderEventDoc>;
export const OrderEventSchema = SchemaFactory.createForClass(OrderEventDoc);

OrderEventSchema.index({ publishedAt: 1, occurredAt: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TableStatus =
  | 'available'
  | 'occupied'
  | 'reserved'
  | 'cleaning'
  | 'out_of_order';

@Schema({ collection: 'tables' })
export class TableDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, required: true, index: true })
  venueId!: string;

  @Prop({ type: String, default: 'Sảnh' })
  section!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: Number, default: 4 })
  capacity!: number;

  @Prop({ type: { x: Number, y: Number }, default: null, _id: false })
  position!: { x: number; y: number } | null;

  @Prop({
    type: String,
    enum: ['available', 'occupied', 'reserved', 'cleaning', 'out_of_order'],
    default: 'available',
    index: true,
  })
  status!: TableStatus;

  @Prop({ type: String, default: null })
  currentOrderId!: string | null;

  @Prop({ type: Date, default: null })
  occupiedSince!: Date | null;

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

export type TableDocument = HydratedDocument<TableDoc>;
export const TableSchema = SchemaFactory.createForClass(TableDoc);

TableSchema.index({ tenantId: 1, venueId: 1, section: 1, name: 1 }, { unique: true });
TableSchema.index({ tenantId: 1, venueId: 1, status: 1 });

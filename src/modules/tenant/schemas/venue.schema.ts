import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BusinessType =
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'hotel'
  | 'homestay'
  | 'spa'
  | 'gym'
  | 'education'
  | 'coworking';

export type VenueStatus = 'active' | 'inactive' | 'archived';

@Schema({ collection: 'venues' })
export class VenueDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  code!: string;

  @Prop({
    type: String,
    enum: [
      'restaurant',
      'cafe',
      'bar',
      'hotel',
      'homestay',
      'spa',
      'gym',
      'education',
      'coworking',
    ],
    required: true,
  })
  businessType!: BusinessType;

  @Prop({
    type: {
      line1: { type: String },
      ward: { type: String },
      district: { type: String },
      city: { type: String },
      province: { type: String },
      country: { type: String, default: 'VN' },
    },
    default: () => ({}),
    _id: false,
  })
  address!: {
    line1?: string;
    ward?: string;
    district?: string;
    city?: string;
    province?: string;
    country?: string;
  };

  @Prop({
    type: { phone: { type: String }, email: { type: String } },
    default: () => ({}),
    _id: false,
  })
  contact!: { phone?: string; email?: string };

  @Prop({ type: String, default: 'Asia/Ho_Chi_Minh' })
  timezone!: string;

  @Prop({ type: String, default: 'VND' })
  currency!: string;

  @Prop({ type: String, enum: ['active', 'inactive', 'archived'], default: 'active', index: true })
  status!: VenueStatus;

  @Prop({
    type: {
      serviceChargeRate: { type: Number, default: 0 },
      vatRate: { type: Number, default: 0.08 },
      autoEinvoice: { type: Boolean, default: false },
      einvoiceProvider: { type: String, default: null },
      bankAccount: {
        type: {
          bankBin: { type: String, default: null },
          bankName: { type: String, default: null },
          accountNumber: { type: String, default: null },
          accountName: { type: String, default: null },
        },
        default: null,
        _id: false,
      },
    },
    default: () => ({}),
    _id: false,
  })
  settings!: {
    serviceChargeRate: number;
    vatRate: number;
    autoEinvoice: boolean;
    einvoiceProvider: string | null;
    bankAccount: {
      bankBin: string | null;
      bankName: string | null;
      accountNumber: string | null;
      accountName: string | null;
    } | null;
  };

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

export type VenueDocument = HydratedDocument<VenueDoc>;
export const VenueSchema = SchemaFactory.createForClass(VenueDoc);

VenueSchema.index({ tenantId: 1, code: 1 }, { unique: true });
VenueSchema.index({ tenantId: 1, status: 1 });

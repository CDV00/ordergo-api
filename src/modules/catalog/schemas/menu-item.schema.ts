import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

const MoneyShape = {
  amount: { type: Number, required: true },
  currency: { type: String, default: 'VND' },
};

const VariantShape = {
  id: { type: String, required: true },
  name: { type: String, required: true },
  priceModifier: { type: MoneyShape, required: true, _id: false },
  isDefault: { type: Boolean, default: false },
};

const ToppingOptionShape = {
  id: { type: String, required: true },
  name: { type: String, required: true },
  priceModifier: { type: MoneyShape, required: true, _id: false },
  isAvailable: { type: Boolean, default: true },
};

const ToppingGroupShape = {
  id: { type: String, required: true },
  name: { type: String, required: true },
  minSelect: { type: Number, default: 0 },
  maxSelect: { type: Number, default: 1 },
  options: { type: [ToppingOptionShape], default: [] },
};

@Schema({ collection: 'menu_items' })
export class MenuItemDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

  @Prop({ type: String, default: null, index: true })
  venueId!: string | null;

  @Prop({ type: String, required: true, index: true })
  categoryId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, default: null })
  description!: string | null;

  @Prop({ type: String, default: null })
  sku!: string | null;

  @Prop({ type: MoneyShape, required: true, _id: false })
  basePrice!: { amount: number; currency: string };

  @Prop({ type: String, default: null })
  imageUrl!: string | null;

  @Prop({ type: Number, default: 0 })
  displayOrder!: number;

  @Prop({ type: [VariantShape], default: [] })
  variants!: Array<{
    id: string;
    name: string;
    priceModifier: { amount: number; currency: string };
    isDefault: boolean;
  }>;

  @Prop({ type: [ToppingGroupShape], default: [] })
  toppingGroups!: Array<{
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    options: Array<{
      id: string;
      name: string;
      priceModifier: { amount: number; currency: string };
      isAvailable: boolean;
    }>;
  }>;

  @Prop({ type: Boolean, default: true, index: true })
  isAvailable!: boolean;

  @Prop({ type: String, default: null })
  unavailableReason!: string | null;

  @Prop({ type: [String], default: [] })
  tags!: string[];

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

export type MenuItemDocument = HydratedDocument<MenuItemDoc>;
export const MenuItemSchema = SchemaFactory.createForClass(MenuItemDoc);

MenuItemSchema.index({ tenantId: 1, venueId: 1, categoryId: 1, displayOrder: 1 });
MenuItemSchema.index({ tenantId: 1, venueId: 1, isAvailable: 1 });
MenuItemSchema.index({ tenantId: 1, sku: 1 }, { sparse: true });

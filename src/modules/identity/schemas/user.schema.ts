import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserStatus = 'active' | 'suspended' | 'deleted';

@Schema({ collection: 'users', timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } })
export class UserDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  phone!: string;

  @Prop({ type: String, default: null, index: true, sparse: true })
  email!: string | null;

  @Prop({ type: String, required: true })
  passwordHash!: string;

  @Prop({ type: String, required: true })
  displayName!: string;

  @Prop({ type: String, default: null })
  avatarUrl!: string | null;

  @Prop({ type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' })
  status!: UserStatus;

  @Prop({ type: Date, default: null })
  emailVerifiedAt!: Date | null;

  @Prop({ type: Date, default: null })
  phoneVerifiedAt!: Date | null;

  @Prop({ type: Boolean, default: false })
  twoFactorEnabled!: boolean;

  @Prop({ type: String, default: null })
  twoFactorSecret!: string | null;

  @Prop({ type: Date, default: null })
  lastLoginAt!: Date | null;

  @Prop({ type: String, default: 'vi' })
  preferredLanguage!: string;

  @Prop({ type: Number, default: 1 })
  schemaVersion!: number;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  // timestamps managed by mongoose
  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<UserDoc>;
export const UserSchema = SchemaFactory.createForClass(UserDoc);

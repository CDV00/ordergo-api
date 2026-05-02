import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ collection: 'refresh_tokens' })
export class RefreshTokenDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true, unique: true })
  tokenHash!: string;

  @Prop({
    type: {
      ua: { type: String },
      ip: { type: String },
      deviceId: { type: String },
    },
    _id: false,
  })
  deviceInfo!: { ua?: string; ip?: string; deviceId?: string };

  @Prop({ type: Date, required: true, index: { expires: 0 } })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshTokenDoc>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshTokenDoc);

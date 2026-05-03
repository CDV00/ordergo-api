import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ collection: 'otp_attempts' })
export class OtpAttemptDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  phone!: string;

  /** sha256 hash của 6-digit code — không lưu plain */
  @Prop({ type: String, required: true })
  codeHash!: string;

  @Prop({ type: Date, required: true, index: { expires: 0 } })
  expiresAt!: Date;

  @Prop({ type: Number, default: 0 })
  attempts!: number;

  @Prop({ type: Date, default: null })
  consumedAt!: Date | null;

  @Prop({ type: String, default: null })
  ipAddress!: string | null;

  /** Mục đích — phòng cross-purpose reuse */
  @Prop({
    type: String,
    enum: ['customer_claim', 'staff_login', 'reset_password'],
    default: 'customer_claim',
  })
  purpose!: 'customer_claim' | 'staff_login' | 'reset_password';

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;
}

export type OtpAttemptDocument = HydratedDocument<OtpAttemptDoc>;
export const OtpAttemptSchema = SchemaFactory.createForClass(OtpAttemptDoc);

OtpAttemptSchema.index({ phone: 1, purpose: 1, createdAt: -1 });

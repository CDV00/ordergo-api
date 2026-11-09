import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Giữ bản ghi idempotency 48 giờ — đủ cho POS mất mạng qua đêm rồi gửi lại. */
export const IDEMPOTENCY_TTL_SECONDS = 48 * 60 * 60;

/**
 * Collection `idempotency_keys`: mỗi (tenantId, key) một bản ghi.
 *  - `in_progress`: request đầu tiên đang chạy (chặn request trùng chạy song song)
 *  - `completed`  : đã chạy xong 2xx — lưu status + body để trả lại y hệt khi gửi lại
 * Request lỗi KHÔNG được lưu (bản ghi bị xoá) để client sửa rồi "Thử lại" với cùng key.
 */
@Schema({ collection: 'idempotency_keys' })
export class IdempotencyKeyDoc {
  @Prop({ type: String, required: true }) tenantId!: string;
  @Prop({ type: String, required: true }) key!: string;
  @Prop({ type: String, required: true }) method!: string;
  @Prop({ type: String, required: true }) path!: string;
  @Prop({ type: String, required: true, enum: ['in_progress', 'completed'] })
  state!: 'in_progress' | 'completed';
  @Prop({ type: Number, default: null }) status!: number | null;
  @Prop({ type: Object, default: null }) responseBody!: unknown;
  @Prop({ type: Date, required: true }) createdAt!: Date;
}

export const IdempotencyKeySchema = SchemaFactory.createForClass(IdempotencyKeyDoc);
IdempotencyKeySchema.index({ tenantId: 1, key: 1 }, { unique: true });
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: IDEMPOTENCY_TTL_SECONDS });

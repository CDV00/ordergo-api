import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Đếm đăng nhập sai theo tài khoản (SĐT) — chống dò mật khẩu từ nhiều IP.
 * Lưu Mongo (không phải bộ nhớ) để giữ qua restart và đúng khi chạy nhiều instance.
 * Không lưu SĐT: `key` = sha256 của SĐT đã chuẩn hoá. TTL index tự dọn bản ghi hết hạn.
 */
@Schema({ collection: 'login_attempts', versionKey: false })
export class LoginAttemptDoc {
  @Prop({ type: String, required: true, unique: true })
  key!: string;

  /** Số lần sai trong cửa sổ hiện tại */
  @Prop({ type: Number, default: 0 })
  failures!: number;

  /** Thời điểm lần sai đầu tiên của cửa sổ 15 phút */
  @Prop({ type: Date, required: true })
  windowStart!: Date;

  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  /** Mongo TTL xoá bản ghi sau thời điểm này (hết cửa sổ hoặc hết khoá) */
  @Prop({ type: Date, required: true, index: { expires: 0 } })
  expiresAt!: Date;
}

export const LoginAttemptSchema = SchemaFactory.createForClass(LoginAttemptDoc);

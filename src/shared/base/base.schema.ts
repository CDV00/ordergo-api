import { Prop } from '@nestjs/mongoose';

/**
 * Audit fields chuẩn cho mọi document nghiệp vụ.
 * Dùng kế thừa: `class FooDoc extends BaseTenantDoc { ... }`.
 *
 * Lưu ý: với @nestjs/mongoose v11, cách kế thừa qua decorator hoạt động
 * khi class abstract có @Schema() ở subclass. Ở đây ta giữ field plain
 * và copy vào từng schema cụ thể qua mixin.
 */
export interface AuditFields {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  schemaVersion: number;
}

export interface TenantScopedFields extends AuditFields {
  tenantId: string;
}

/**
 * Mixin thêm các field chuẩn vào subclass (cho Mongoose).
 * Mongoose tôn trọng @Prop từ class cha thông qua TypeScript prototype chain.
 */
export class BaseTenantDoc {
  @Prop({ type: String, required: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  tenantId!: string;

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

/** Cho document toàn cục (không thuộc tenant) như User */
export class BaseGlobalDoc {
  @Prop({ type: String, required: true, unique: true })
  id!: string;

  @Prop({ type: Number, default: 1 })
  schemaVersion!: number;

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;

  @Prop({ type: Date, default: () => new Date() })
  updatedAt!: Date;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;
}

import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { newId } from '../../shared/utils/uuid';

/**
 * Audit log append-only (collection `audit_logs`). Ghi: xem PII đầy đủ (reveal), export, in,
 * thay đổi quyền/nhân viên, thao tác tài chính nhạy cảm.
 * KHÔNG BAO GIỜ đưa giá trị PII (SĐT, tên, ngày sinh...) vào `metadata` — chỉ id + số lượng.
 */
@Schema({ collection: 'audit_logs' })
export class AuditLogDoc {
  @Prop({ type: String, required: true, unique: true }) id!: string;
  @Prop({ type: String, required: true }) tenantId!: string;
  @Prop({ type: String, default: null }) userId!: string | null;
  /** vd "customer.reveal", "report.export", "staff.role_change" */
  @Prop({ type: String, required: true }) action!: string;
  @Prop({ type: String, required: true }) entityType!: string;
  @Prop({ type: String, default: null }) entityId!: string | null;
  @Prop({ type: Object, default: {} }) metadata!: Record<string, unknown>;
  @Prop({ type: Date, required: true }) timestamp!: Date;
}
export const AuditLogSchema = SchemaFactory.createForClass(AuditLogDoc);
AuditLogSchema.index({ tenantId: 1, timestamp: -1 });
AuditLogSchema.index({ tenantId: 1, action: 1, userId: 1, timestamp: -1 });
AuditLogSchema.index({ tenantId: 1, entityType: 1, entityId: 1, timestamp: -1 });

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(
    @InjectModel(AuditLogDoc.name) private readonly model: Model<AuditLogDoc>,
    private readonly tenantCtx: TenantContextService,
  ) {}

  /** Ghi 1 dòng audit với tenant/user lấy từ context đã xác thực (không nhận từ client). */
  async record(entry: {
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const ctx = this.tenantCtx.current();
    if (!ctx?.tenantId) {
      this.logger.warn(`Bỏ qua audit "${entry.action}" — không có tenant trong context`);
      return;
    }
    await this.model.create({
      id: newId(),
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
      timestamp: new Date(),
    });
  }

  /** Số lần `action` của user hiện tại trong `windowMs` gần nhất — dùng làm giới hạn export/reveal. */
  async countRecent(action: string, windowMs: number): Promise<number> {
    const ctx = this.tenantCtx.current();
    if (!ctx?.tenantId) return 0;
    return this.model
      .countDocuments({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action,
        timestamp: { $gte: new Date(Date.now() - windowMs) },
      })
      .exec();
  }
}

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLogDoc.name, schema: AuditLogSchema }])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

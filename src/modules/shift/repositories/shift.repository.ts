import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ShiftDoc } from '../schemas/shift.schema';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { BaseTenantRepository } from '../../../shared/base/base.repository';

@Injectable()
export class ShiftRepository extends BaseTenantRepository<ShiftDoc> {
  constructor(@InjectModel(ShiftDoc.name) model: Model<ShiftDoc>, tenantCtx: TenantContextService) {
    super(model, tenantCtx);
  }

  /** Ca đang mở của cơ sở (tối đa 1 — có unique index partial). */
  async findOpen(venueId: string): Promise<ShiftDoc | null> {
    return this.findOne({ venueId, status: 'open' });
  }

  /**
   * Đóng ca nguyên tử: chỉ cập nhật khi ca còn `open` → 2 người bấm đóng cùng lúc thì
   * người sau nhận null (không ghi đè số liệu của người trước).
   */
  async closeIfOpen(id: string, set: Partial<ShiftDoc>): Promise<ShiftDoc | null> {
    const userId = this.tenantCtx.current()?.userId ?? null;
    const updated = await this.model
      .findOneAndUpdate(
        this.mergeFilter({ id, status: 'open' }) as never,
        { $set: { ...set, updatedAt: new Date(), updatedBy: userId } },
        { returnDocument: 'after', lean: true },
      )
      .exec();
    return (updated as ShiftDoc | null) ?? null;
  }
}

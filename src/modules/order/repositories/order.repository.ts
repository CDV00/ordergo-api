import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderDoc } from '../schemas/order.schema';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { BaseTenantRepository } from '../../../shared/base/base.repository';

@Injectable()
export class OrderRepository extends BaseTenantRepository<OrderDoc> {
  constructor(
    @InjectModel(OrderDoc.name) model: Model<OrderDoc>,
    tenantCtx: TenantContextService,
  ) {
    super(model, tenantCtx);
  }

  async nextOrderNumber(tenantId: string, venueId: string): Promise<string> {
    const date = new Date();
    const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
      date.getDate(),
    ).padStart(2, '0')}`;
    const prefix = `ORD-${ymd}-`;
    const last = await this.model
      .findOne({ tenantId, venueId, orderNumber: { $regex: `^${prefix}` } })
      .sort({ orderNumber: -1 })
      .lean<OrderDoc>()
      .exec();
    const nextSeq = last
      ? parseInt(last.orderNumber.substring(prefix.length), 10) + 1
      : 1;
    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }
}

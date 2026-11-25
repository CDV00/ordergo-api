import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaymentDoc } from '../schemas/payment.schema';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { BaseTenantRepository } from '../../../shared/base/base.repository';

@Injectable()
export class PaymentRepository extends BaseTenantRepository<PaymentDoc> {
  constructor(
    @InjectModel(PaymentDoc.name) model: Model<PaymentDoc>,
    tenantCtx: TenantContextService,
  ) {
    super(model, tenantCtx);
  }

  async findByOrder(orderId: string): Promise<PaymentDoc[]> {
    return this.find({ orderId }, { sort: { receivedAt: 1 } });
  }

  /** Số tiền đã thu thực (đã thu − đã hoàn) theo từng đơn. Đơn chưa thu đồng nào không có trong map. */
  async netPaidByOrder(orderIds: string[]): Promise<Map<string, number>> {
    const paid = new Map<string, number>();
    if (orderIds.length === 0) return paid;
    const payments = await this.find({ orderId: { $in: orderIds } });
    for (const p of payments) {
      if (p.status !== 'succeeded' && p.status !== 'partially_refunded') continue;
      const net = p.amount.amount - p.refundedAmount.amount;
      paid.set(p.orderId, (paid.get(p.orderId) ?? 0) + net);
    }
    return paid;
  }
}

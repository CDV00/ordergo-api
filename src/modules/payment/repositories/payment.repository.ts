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
}

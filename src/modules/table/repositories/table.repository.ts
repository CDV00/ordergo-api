import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TableDoc } from '../schemas/table.schema';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { BaseTenantRepository } from '../../../shared/base/base.repository';

@Injectable()
export class TableRepository extends BaseTenantRepository<TableDoc> {
  constructor(@InjectModel(TableDoc.name) model: Model<TableDoc>, tenantCtx: TenantContextService) {
    super(model, tenantCtx);
  }
}

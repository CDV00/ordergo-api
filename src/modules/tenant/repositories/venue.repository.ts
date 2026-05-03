import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VenueDoc } from '../schemas/venue.schema';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { BaseTenantRepository } from '../../../shared/base/base.repository';

@Injectable()
export class VenueRepository extends BaseTenantRepository<VenueDoc> {
  constructor(@InjectModel(VenueDoc.name) model: Model<VenueDoc>, tenantCtx: TenantContextService) {
    super(model, tenantCtx);
  }

  async findByCode(tenantId: string, code: string): Promise<VenueDoc | null> {
    return this.model.findOne({ tenantId, code, deletedAt: null }).lean<VenueDoc>().exec();
  }
}

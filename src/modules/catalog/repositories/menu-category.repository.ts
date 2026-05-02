import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuCategoryDoc } from '../schemas/menu-category.schema';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { BaseTenantRepository } from '../../../shared/base/base.repository';

@Injectable()
export class MenuCategoryRepository extends BaseTenantRepository<MenuCategoryDoc> {
  constructor(
    @InjectModel(MenuCategoryDoc.name) model: Model<MenuCategoryDoc>,
    tenantCtx: TenantContextService,
  ) {
    super(model, tenantCtx);
  }
}

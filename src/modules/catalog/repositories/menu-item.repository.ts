import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuItemDoc } from '../schemas/menu-item.schema';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { BaseTenantRepository } from '../../../shared/base/base.repository';

@Injectable()
export class MenuItemRepository extends BaseTenantRepository<MenuItemDoc> {
  constructor(
    @InjectModel(MenuItemDoc.name) model: Model<MenuItemDoc>,
    tenantCtx: TenantContextService,
  ) {
    super(model, tenantCtx);
  }
}

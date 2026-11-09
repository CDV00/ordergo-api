import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MenuCategoryDoc, MenuCategorySchema } from './schemas/menu-category.schema';
import { MenuItemDoc, MenuItemSchema } from './schemas/menu-item.schema';
import { MenuCategoryRepository } from './repositories/menu-category.repository';
import { MenuItemRepository } from './repositories/menu-item.repository';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MenuCategoryDoc.name, schema: MenuCategorySchema },
      { name: MenuItemDoc.name, schema: MenuItemSchema },
    ]),
    // VenueRepository + TenantAccessService cho sao chép menu. AuditService đến từ AuditModule (@Global).
    TenantModule,
  ],
  providers: [MenuCategoryRepository, MenuItemRepository, CatalogService],
  controllers: [CatalogController],
  exports: [MenuItemRepository, MenuCategoryRepository],
})
export class CatalogModule {}

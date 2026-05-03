import { Module } from '@nestjs/common';
import { PublicApiService } from './public-api.service';
import { PublicApiController } from './public-api.controller';
import { PublicSessionGuard } from './guards/public-session.guard';
import { TenantModule } from '../tenant/tenant.module';
import { TableModule } from '../table/table.module';
import { TableSessionModule } from '../table-session/table-session.module';
import { CustomerModule } from '../customer/customer.module';
import { CatalogModule } from '../catalog/catalog.module';
import { OrderModule } from '../order/order.module';
import { OtpModule } from '../otp/otp.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [
    TenantModule,
    TableModule,
    TableSessionModule,
    CustomerModule,
    CatalogModule,
    OrderModule,
    OtpModule,
    IdentityModule,
  ],
  providers: [PublicApiService, PublicSessionGuard],
  controllers: [PublicApiController],
})
export class PublicApiModule {}

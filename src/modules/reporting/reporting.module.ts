import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderDoc, OrderSchema } from '../order/schemas/order.schema';
import { ReportingService } from './reporting.service';
import { ReportingController } from './reporting.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: OrderDoc.name, schema: OrderSchema }]),
    TenantModule,
  ],
  providers: [ReportingService],
  controllers: [ReportingController],
})
export class ReportingModule {}

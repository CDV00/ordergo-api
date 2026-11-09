import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderDoc, OrderSchema } from './schemas/order.schema';
import { OrderEventDoc, OrderEventSchema } from './schemas/order-event.schema';
import { OrderRepository } from './repositories/order.repository';
import { OrderEventRepository } from './repositories/order-event.repository';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { TableModule } from '../table/table.module';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrderDoc.name, schema: OrderSchema },
      { name: OrderEventDoc.name, schema: OrderEventSchema },
    ]),
    CatalogModule,
    TableModule,
    TenantModule,
  ],
  providers: [OrderRepository, OrderEventRepository, OrderService],
  controllers: [OrderController],
  exports: [OrderRepository, OrderEventRepository, OrderService],
})
export class OrderModule {}

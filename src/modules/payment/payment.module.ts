import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentDoc, PaymentSchema } from './schemas/payment.schema';
import { PaymentRepository } from './repositories/payment.repository';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { OrderModule } from '../order/order.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { TenantModule } from '../tenant/tenant.module';
import { ShiftModule } from '../shift/shift.module';
import { CustomerModule } from '../customer/customer.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PaymentDoc.name, schema: PaymentSchema }]),
    OrderModule,
    LoyaltyModule,
    TenantModule,
    ShiftModule,
    CustomerModule,
  ],
  providers: [PaymentRepository, PaymentService],
  controllers: [PaymentController],
  exports: [PaymentRepository, PaymentService],
})
export class PaymentModule {}

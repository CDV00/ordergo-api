import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentDoc, PaymentSchema } from './schemas/payment.schema';
import { PaymentRepository } from './repositories/payment.repository';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PaymentDoc.name, schema: PaymentSchema }]),
    OrderModule,
  ],
  providers: [PaymentRepository, PaymentService],
  controllers: [PaymentController],
  exports: [PaymentRepository, PaymentService],
})
export class PaymentModule {}

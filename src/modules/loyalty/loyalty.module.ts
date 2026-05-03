import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoyaltyCardDoc, LoyaltyCardSchema } from './schemas/loyalty-card.schema';
import { LoyaltyTxDoc, LoyaltyTxSchema } from './schemas/loyalty-transaction.schema';
import { LoyaltyService } from './loyalty.service';
import { CustomerModule } from '../customer/customer.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LoyaltyCardDoc.name, schema: LoyaltyCardSchema },
      { name: LoyaltyTxDoc.name, schema: LoyaltyTxSchema },
    ]),
    CustomerModule,
  ],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}

import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CustomerDoc, CustomerSchema } from './schemas/customer.schema';
import { CustomerRepository } from './repositories/customer.repository';
import { CustomerTenantRepository } from './repositories/customer-tenant.repository';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { LoyaltyCardDoc, LoyaltyCardSchema } from '../loyalty/schemas/loyalty-card.schema';
import { LoyaltyTxDoc, LoyaltyTxSchema } from '../loyalty/schemas/loyalty-transaction.schema';
import { OrderDoc, OrderSchema } from '../order/schemas/order.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomerDoc.name, schema: CustomerSchema },
      // Đọc thẻ/giao dịch điểm + đơn gần đây cho màn khách hàng. Không import LoyaltyModule
      // (LoyaltyModule đã import CustomerModule → vòng phụ thuộc); model dùng chung connection.
      { name: LoyaltyCardDoc.name, schema: LoyaltyCardSchema },
      { name: LoyaltyTxDoc.name, schema: LoyaltyTxSchema },
      { name: OrderDoc.name, schema: OrderSchema },
    ]),
  ],
  controllers: [CustomerController],
  providers: [CustomerRepository, CustomerTenantRepository, CustomerService],
  exports: [CustomerRepository],
})
export class CustomerModule implements OnModuleInit {
  constructor(@InjectModel(CustomerDoc.name) private readonly model: Model<CustomerDoc>) {}

  /**
   * Đồng bộ index theo schema: xoá index unique cũ (sparse, sai — xem customer.schema.ts) trên DB
   * đã chạy trước bản sửa, tạo index partial mới. Idempotent, chạy cả khi autoIndex=false.
   */
  async onModuleInit(): Promise<void> {
    try {
      const dropped = await this.model.syncIndexes();
      if (dropped.length > 0) {
        new Logger('CustomerModule').log(`Đã đồng bộ index customers, xoá: ${dropped.join(', ')}`);
      }
    } catch (err) {
      new Logger('CustomerModule').error(`syncIndexes customers lỗi: ${(err as Error).message}`);
    }
  }
}

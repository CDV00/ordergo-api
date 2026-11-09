import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CustomerDoc, CustomerSchema } from './schemas/customer.schema';
import { CustomerRepository } from './repositories/customer.repository';

@Module({
  imports: [MongooseModule.forFeature([{ name: CustomerDoc.name, schema: CustomerSchema }])],
  providers: [CustomerRepository],
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

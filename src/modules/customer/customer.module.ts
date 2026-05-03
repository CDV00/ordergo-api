import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomerDoc, CustomerSchema } from './schemas/customer.schema';
import { CustomerRepository } from './repositories/customer.repository';

@Module({
  imports: [MongooseModule.forFeature([{ name: CustomerDoc.name, schema: CustomerSchema }])],
  providers: [CustomerRepository],
  exports: [CustomerRepository],
})
export class CustomerModule {}

import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ShiftDoc, ShiftSchema } from './schemas/shift.schema';
import { ShiftRepository } from './repositories/shift.repository';
import { ShiftService } from './shift.service';
import { ShiftController } from './shift.controller';
import { PaymentDoc, PaymentSchema } from '../payment/schemas/payment.schema';
import { PaymentRepository } from '../payment/repositories/payment.repository';
import { TenantModule } from '../tenant/tenant.module';
import { IdentityModule } from '../identity/identity.module';

/**
 * Ca làm (mở ca với tiền đầu ca, đóng ca đối soát tiền mặt).
 *
 * PaymentModule import module này để gắn payment vào ca đang mở → ở đây KHÔNG import PaymentModule
 * (tránh vòng phụ thuộc); chỉ đăng ký model payments và dùng PaymentRepository cục bộ để đọc.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ShiftDoc.name, schema: ShiftSchema },
      { name: PaymentDoc.name, schema: PaymentSchema },
    ]),
    TenantModule,
    IdentityModule,
  ],
  providers: [ShiftRepository, PaymentRepository, ShiftService],
  controllers: [ShiftController],
  exports: [ShiftRepository],
})
export class ShiftModule implements OnModuleInit {
  constructor(@InjectModel(ShiftDoc.name) private readonly model: Model<ShiftDoc>) {}

  /** Tạo unique index partial "1 ca mở / cơ sở" kể cả khi autoIndex=false (production). */
  async onModuleInit(): Promise<void> {
    try {
      await this.model.syncIndexes();
    } catch (err) {
      new Logger('ShiftModule').error(`syncIndexes shifts lỗi: ${(err as Error).message}`);
    }
  }
}

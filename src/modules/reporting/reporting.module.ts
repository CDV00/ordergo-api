import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderDoc, OrderSchema } from '../order/schemas/order.schema';
import { PaymentDoc, PaymentSchema } from '../payment/schemas/payment.schema';
import { UserDoc, UserSchema } from '../identity/schemas/user.schema';
import { ReportingService } from './reporting.service';
import { SalesReportService } from './sales-report.service';
import { ReportingController } from './reporting.controller';
import { ReportScopeService } from './report-scope';

// AuditService đến từ AuditModule (@Global) — không cần import.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrderDoc.name, schema: OrderSchema },
      { name: PaymentDoc.name, schema: PaymentSchema },
      // Chỉ đọc `displayName` cho báo cáo nhân viên (users là collection toàn hệ thống).
      { name: UserDoc.name, schema: UserSchema },
    ]),
    TenantModule,
  ],
  providers: [ReportingService, SalesReportService, ReportScopeService],
  controllers: [ReportingController],
})
export class ReportingModule {}

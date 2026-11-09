import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { TenantContextModule } from './common/context/tenant-context.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { IdentityModule } from './modules/identity/identity.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { TableModule } from './modules/table/table.module';
import { OrderModule } from './modules/order/order.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { TableSessionModule } from './modules/table-session/table-session.module';
import { CustomerModule } from './modules/customer/customer.module';
import { OtpModule } from './modules/otp/otp.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { StorageModule } from './modules/storage/storage.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { AuditModule } from './modules/audit/audit.module';
import { ShiftModule } from './modules/shift/shift.module';
import { StaffModule } from './modules/staff/staff.module';
import { JwtModule } from '@nestjs/jwt';
import { HealthController } from './common/health/health.controller';
import { AppThrottlerGuard, AppThrottlerModule } from './common/throttle/throttle';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.development', '.env'],
      validationSchema: envValidationSchema,
    }),
    JwtModule.register({}), // global instance for middleware (uses dynamic secret)
    ScheduleModule.forRoot(),
    AppThrottlerModule,
    TenantContextModule,
    DatabaseModule,
    IdempotencyModule,
    AuditModule,
    IdentityModule,
    TenantModule,
    CatalogModule,
    TableModule,
    OrderModule,
    PaymentModule,
    ReportingModule,
    TableSessionModule,
    CustomerModule,
    OtpModule,
    LoyaltyModule,
    PublicApiModule,
    StorageModule,
    RealtimeModule,
    ShiftModule,
    StaffModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    // Thứ tự quan trọng: JwtAuthGuard gắn req.user → throttler đếm theo user (hoặc IP nếu @Public).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}

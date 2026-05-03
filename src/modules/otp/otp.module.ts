import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OtpAttemptDoc, OtpAttemptSchema } from './schemas/otp-attempt.schema';
import { OtpService } from './otp.service';
import { ConsoleSmsAdapter, SMS_ADAPTER } from './sms-adapter';

@Module({
  imports: [MongooseModule.forFeature([{ name: OtpAttemptDoc.name, schema: OtpAttemptSchema }])],
  providers: [OtpService, { provide: SMS_ADAPTER, useClass: ConsoleSmsAdapter }],
  exports: [OtpService],
})
export class OtpModule {}

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { UserDoc, UserSchema } from './schemas/user.schema';
import { RefreshTokenDoc, RefreshTokenSchema } from './schemas/refresh-token.schema';
import { LoginAttemptDoc, LoginAttemptSchema } from './schemas/login-attempt.schema';
import { LoginLockoutService } from './login-lockout.service';
import { UserRepository } from './repositories/user.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserDoc.name, schema: UserSchema },
      { name: RefreshTokenDoc.name, schema: RefreshTokenSchema },
      { name: LoginAttemptDoc.name, schema: LoginAttemptSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
      inject: [ConfigService],
    }),
    TenantModule,
  ],
  providers: [UserRepository, RefreshTokenRepository, LoginLockoutService, AuthService],
  controllers: [AuthController],
  exports: [JwtModule, AuthService, UserRepository],
})
export class IdentityModule {}

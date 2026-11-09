import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IdempotencyKeyDoc, IdempotencyKeySchema } from './idempotency.schema';
import { IdempotencyStore, MongoIdempotencyStore } from './idempotency.store';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/** Global để mọi module dùng được `@Idempotent()` mà không cần import. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: IdempotencyKeyDoc.name, schema: IdempotencyKeySchema }]),
  ],
  providers: [
    { provide: IdempotencyStore, useClass: MongoIdempotencyStore },
    IdempotencyService,
    IdempotencyInterceptor,
  ],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}

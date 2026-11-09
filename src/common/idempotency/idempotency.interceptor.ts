import {
  applyDecorators,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import { TenantContextService } from '../context/tenant-context.service';
import { IdempotencyService } from './idempotency.service';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * Interceptor cho route ghi có thể bị gửi lại (POS offline). Không có header → chạy như cũ.
 * Chạy sau guard (tenant đã xác thực) và bên trong TransformInterceptor toàn cục, nên body lưu
 * là giá trị thô của handler — lần gửi lại vẫn được bọc `{ data }` như bình thường.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly service: IdempotencyService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const raw = req.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) return next.handle();

    const tenantId = this.tenantCtx.tenantId();
    // Nest đã đặt status thành công (201 cho POST / @HttpCode) trước khi gọi interceptor.
    const successStatus = res.statusCode;
    return from(
      this.service
        .execute({ tenantId, key, method: req.method, path: req.path, successStatus }, () =>
          lastValueFrom(next.handle(), { defaultValue: undefined }),
        )
        .then((result) => {
          if (result.replayed) {
            res.status(result.status);
            res.setHeader('Idempotent-Replayed', 'true');
          }
          return result.body;
        }),
    );
  }
}

/** Đánh dấu route ghi hỗ trợ header `Idempotency-Key` (lưu 48h, theo tenant). */
export const Idempotent = () => applyDecorators(UseInterceptors(IdempotencyInterceptor));

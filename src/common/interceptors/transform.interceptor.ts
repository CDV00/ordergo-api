import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

interface Wrapped<T> {
  data: T;
  pagination?: unknown;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Wrapped<T>> {
  intercept(_: ExecutionContext, next: CallHandler<T>): Observable<Wrapped<T>> {
    return next.handle().pipe(
      map((value) => {
        // Đã trả format { data, pagination } từ controller → giữ nguyên
        if (
          value &&
          typeof value === 'object' &&
          'data' in (value as object)
        ) {
          return value as unknown as Wrapped<T>;
        }
        return { data: value as T };
      }),
    );
  }
}

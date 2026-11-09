import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpCtx = host.switchToHttp();
    const res = httpCtx.getResponse<Response>();
    const req = httpCtx.getRequest<Request>();
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    const body: ErrorBody = {
      code: 'INTERNAL_ERROR',
      message: 'Có lỗi xảy ra, vui lòng thử lại.',
      requestId,
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (typeof r === 'string') {
        body.code = this.codeFromStatus(status);
        body.message = r;
      } else if (typeof r === 'object' && r !== null) {
        const obj = r as Record<string, unknown>;
        body.code = (obj.code as string) ?? this.codeFromStatus(status);
        body.message =
          (obj.message as string) ??
          (Array.isArray(obj.message) ? (obj.message as string[]).join(', ') : '') ??
          this.codeFromStatus(status);
        if (obj.details !== undefined) body.details = obj.details;
        // class-validator: message is array
        if (Array.isArray((obj as { message?: unknown }).message)) {
          body.code = 'VALIDATION_FAILED';
          body.details = (obj as { message?: string[] }).message;
          body.message = 'Dữ liệu không hợp lệ.';
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack, requestId);
      body.message = process.env.NODE_ENV === 'production' ? body.message : exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status} ${body.code}`,
        exception instanceof Error ? exception.stack : String(exception),
        requestId,
      );
    }

    res.setHeader('X-Request-Id', requestId);
    res.status(status).json({ error: body });
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'UNPROCESSABLE';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'ERROR';
    }
  }
}

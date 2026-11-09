import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { IdempotencyStore } from './idempotency.store';

/** Key hợp lệ: UUID hoặc chuỗi ngẫu nhiên tương tự (8–128 ký tự chữ/số/-/_). */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export interface IdempotentRequest {
  tenantId: string;
  key: string;
  method: string;
  path: string;
  /** Status HTTP mà handler sẽ trả khi thành công (vd 201 cho POST). */
  successStatus: number;
}

export interface IdempotentResult {
  replayed: boolean;
  status: number;
  body: unknown;
}

export interface IdempotencyOptions {
  /** Chờ request trùng đang chạy tối đa bao lâu trước khi trả 409. */
  waitMs: number;
  pollMs: number;
  /** Bản ghi `in_progress` cũ hơn ngưỡng này coi như bị bỏ dở (process chết giữa chừng). */
  staleMs: number;
}

const DEFAULT_OPTIONS: IdempotencyOptions = { waitMs: 3_000, pollMs: 100, staleMs: 60_000 };

export function isValidIdempotencyKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** Bỏ kiểu Mongoose/Date… → JSON thuần, đúng như body mà client nhận lần đầu. */
function toPlainJson(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chạy handler đúng 1 lần cho mỗi (tenantId, Idempotency-Key):
 *  - lần đầu: giữ chỗ (`in_progress`) → chạy → lưu status + body (chỉ khi thành công)
 *  - gửi lại cùng method + path: trả body đã lưu, không chạy lại
 *  - cùng key khác method/path: 422 IDEMPOTENCY_KEY_REUSED
 *  - trùng lúc đang chạy: chờ tối đa `waitMs`, xong thì trả kết quả, không thì 409 IDEMPOTENCY_IN_PROGRESS
 *  - handler ném lỗi: xoá giữ chỗ → client có thể thử lại với cùng key
 */
@Injectable()
export class IdempotencyService {
  private options: IdempotencyOptions = DEFAULT_OPTIONS;

  constructor(private readonly store: IdempotencyStore) {}

  /** Chỉ dùng trong test. */
  configure(options: Partial<IdempotencyOptions>): void {
    this.options = { ...this.options, ...options };
  }

  async execute(
    req: IdempotentRequest,
    handler: () => Promise<unknown>,
  ): Promise<IdempotentResult> {
    if (!isValidIdempotencyKey(req.key)) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'Idempotency-Key không hợp lệ (cần UUID).',
      });
    }

    // Tối đa 2 vòng: vòng 2 chỉ xảy ra khi giữ chỗ cũ bị bỏ dở / request trước lỗi và được xoá.
    for (let attempt = 0; attempt < 2; attempt++) {
      const createdAt = new Date();
      const inserted = await this.store.tryInsert({
        tenantId: req.tenantId,
        key: req.key,
        method: req.method,
        path: req.path,
        state: 'in_progress',
        status: null,
        responseBody: null,
        createdAt,
      });
      if (inserted) return this.runFirst(req, createdAt, handler);

      const outcome = await this.awaitExisting(req);
      if (outcome) return outcome;
    }
    throw this.inProgress();
  }

  private async runFirst(
    req: IdempotentRequest,
    createdAt: Date,
    handler: () => Promise<unknown>,
  ): Promise<IdempotentResult> {
    let body: unknown;
    try {
      body = toPlainJson(await handler());
    } catch (err) {
      await this.store.release(req.tenantId, req.key, createdAt).catch(() => undefined);
      throw err;
    }
    await this.store.complete(req.tenantId, req.key, req.successStatus, body);
    return { replayed: false, status: req.successStatus, body };
  }

  /**
   * Đã có bản ghi cho key: trả kết quả đã lưu, hoặc chờ request kia xong.
   * Trả null nếu bản ghi đã biến mất (request kia lỗi / bỏ dở) → gọi lại để giữ chỗ.
   */
  private async awaitExisting(req: IdempotentRequest): Promise<IdempotentResult | null> {
    const deadline = Date.now() + this.options.waitMs;
    for (;;) {
      const existing = await this.store.find(req.tenantId, req.key);
      if (!existing) return null;

      if (existing.method !== req.method || existing.path !== req.path) {
        throw new UnprocessableEntityException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Idempotency-Key đã dùng cho một thao tác khác.',
          details: { method: existing.method, path: existing.path },
        });
      }

      if (existing.state === 'completed') {
        return {
          replayed: true,
          status: existing.status ?? req.successStatus,
          body: existing.responseBody,
        };
      }

      const age = Date.now() - new Date(existing.createdAt).getTime();
      if (age > this.options.staleMs) {
        await this.store.release(req.tenantId, req.key, existing.createdAt);
        return null;
      }

      if (Date.now() >= deadline) throw this.inProgress();
      await sleep(this.options.pollMs);
    }
  }

  private inProgress(): ConflictException {
    return new ConflictException({
      code: 'IDEMPOTENCY_IN_PROGRESS',
      message: 'Yêu cầu này đang được xử lý, vui lòng thử lại sau giây lát.',
    });
  }
}

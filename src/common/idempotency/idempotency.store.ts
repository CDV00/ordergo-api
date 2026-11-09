import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { IdempotencyKeyDoc } from './idempotency.schema';

export interface IdempotencyRecord {
  tenantId: string;
  key: string;
  method: string;
  path: string;
  state: 'in_progress' | 'completed';
  status: number | null;
  responseBody: unknown;
  createdAt: Date;
}

/** Lớp lưu trữ tách riêng để unit test service bằng store trong bộ nhớ. */
export abstract class IdempotencyStore {
  /** Chèn bản ghi `in_progress`. Trả false nếu (tenantId, key) đã tồn tại. */
  abstract tryInsert(rec: IdempotencyRecord): Promise<boolean>;
  abstract find(tenantId: string, key: string): Promise<IdempotencyRecord | null>;
  abstract complete(tenantId: string, key: string, status: number, body: unknown): Promise<void>;
  /** Xoá bản ghi `in_progress` (request lỗi / bị bỏ dở). `createdAt` để không xoá nhầm bản mới. */
  abstract release(tenantId: string, key: string, createdAt?: Date): Promise<void>;
}

function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 11000;
}

@Injectable()
export class MongoIdempotencyStore extends IdempotencyStore {
  private indexes: Promise<void> | null = null;

  constructor(
    @InjectModel(IdempotencyKeyDoc.name) private readonly model: Model<IdempotencyKeyDoc>,
  ) {
    super();
  }

  /**
   * Unique index là thứ chặn chạy trùng, nên phải chắc chắn nó có trước lần chèn đầu:
   * autoIndex tắt ở production, và e2e xoá DB sau khi app khởi động.
   */
  private ensureIndexes(): Promise<void> {
    this.indexes ??= this.model
      .createIndexes()
      .then(() => undefined)
      .catch((err: unknown) => {
        this.indexes = null;
        throw err;
      });
    return this.indexes;
  }

  async tryInsert(rec: IdempotencyRecord): Promise<boolean> {
    await this.ensureIndexes();
    try {
      await this.model.create(rec);
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  async find(tenantId: string, key: string): Promise<IdempotencyRecord | null> {
    return this.model.findOne({ tenantId, key }).lean<IdempotencyRecord>().exec();
  }

  async complete(tenantId: string, key: string, status: number, body: unknown): Promise<void> {
    await this.model
      .updateOne(
        { tenantId, key, state: 'in_progress' },
        { $set: { state: 'completed', status, responseBody: body } },
      )
      .exec();
  }

  async release(tenantId: string, key: string, createdAt?: Date): Promise<void> {
    await this.model
      .deleteOne({
        tenantId,
        key,
        state: 'in_progress',
        ...(createdAt ? { createdAt } : {}),
      })
      .exec();
  }
}

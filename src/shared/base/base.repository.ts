import { NotFoundException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { newId } from '../utils/uuid';

// Mongoose 9 không export FilterQuery/UpdateQuery public — dùng record loose ở base layer.
type LooseFilter = Record<string, unknown>;
type LooseUpdate = Record<string, unknown>;

export interface FindOptions {
  skip?: number;
  limit?: number;
  sort?: Record<string, 1 | -1>;
  includeDeleted?: boolean;
}

/**
 * Repository base — auto inject `tenantId` + `deletedAt: null` filter.
 * Module domain *chỉ* được gọi qua repository này, không gọi `model` raw,
 * để đảm bảo tenant isolation và soft delete consistent.
 */
export abstract class BaseTenantRepository<TDoc extends { id: string; tenantId: string }> {
  constructor(
    protected readonly model: Model<TDoc>,
    protected readonly tenantCtx: TenantContextService,
  ) {}

  protected mergeFilter(extra: LooseFilter = {}, includeDeleted = false): LooseFilter {
    const base: LooseFilter = { tenantId: this.tenantCtx.tenantId() };
    if (!includeDeleted) base.deletedAt = null;
    return { ...base, ...extra };
  }

  async findById(id: string, opts: FindOptions = {}): Promise<TDoc | null> {
    return this.model
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .findOne(this.mergeFilter({ id }, opts.includeDeleted) as any)
      .lean<TDoc>()
      .exec();
  }

  async findByIdOrFail(id: string, opts: FindOptions = {}): Promise<TDoc> {
    const doc = await this.findById(id, opts);
    if (!doc) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy bản ghi.',
        details: { id },
      });
    }
    return doc;
  }

  async findOne(filter: LooseFilter, opts: FindOptions = {}): Promise<TDoc | null> {
    return this.model
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .findOne(this.mergeFilter(filter, opts.includeDeleted) as any)
      .lean<TDoc>()
      .exec();
  }

  async find(filter: LooseFilter = {}, opts: FindOptions = {}): Promise<TDoc[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = this.model.find(this.mergeFilter(filter, opts.includeDeleted) as any);
    if (opts.sort) q = q.sort(opts.sort);
    if (typeof opts.skip === 'number') q = q.skip(opts.skip);
    if (typeof opts.limit === 'number') q = q.limit(opts.limit);
    return q.lean<TDoc[]>().exec();
  }

  async count(filter: LooseFilter = {}, opts: FindOptions = {}): Promise<number> {
    return this.model
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .countDocuments(this.mergeFilter(filter, opts.includeDeleted) as any)
      .exec();
  }

  async create(data: Partial<TDoc>): Promise<TDoc> {
    const userId = this.tenantCtx.current()?.userId ?? null;
    const tenantId = this.tenantCtx.tenantId();
    const now = new Date();
    const doc = {
      id: newId(),
      tenantId,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
      ...data,
    } as unknown as TDoc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await this.model.create(doc as any);
    return (created as { toObject(): TDoc }).toObject();
  }

  async createWithTenant(tenantId: string, data: Partial<TDoc>): Promise<TDoc> {
    const userId = this.tenantCtx.current()?.userId ?? null;
    const now = new Date();
    const doc = {
      id: newId(),
      tenantId,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
      ...data,
    } as unknown as TDoc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await this.model.create(doc as any);
    return (created as { toObject(): TDoc }).toObject();
  }

  async updateById(id: string, patch: LooseUpdate): Promise<TDoc> {
    const userId = this.tenantCtx.current()?.userId ?? null;
    const setClause = {
      ...((patch.$set as object) ?? {}),
      updatedAt: new Date(),
      updatedBy: userId,
    };
    const finalPatch = { ...patch, $set: setClause };
    const updated = await this.model
      .findOneAndUpdate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.mergeFilter({ id }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        finalPatch as any,
        { new: true, lean: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy bản ghi.',
        details: { id },
      });
    }
    return updated as unknown as TDoc;
  }

  async softDelete(id: string): Promise<void> {
    const userId = this.tenantCtx.current()?.userId ?? null;
    const result = await this.model
      .updateOne(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.mergeFilter({ id }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { $set: { deletedAt: new Date(), updatedAt: new Date(), updatedBy: userId } } as any,
      )
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy bản ghi.',
        details: { id },
      });
    }
  }

  protected rawModel(): Model<TDoc> {
    return this.model;
  }
}

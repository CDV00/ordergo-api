import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TenantDoc } from '../schemas/tenant.schema';
import { newId } from '../../../shared/utils/uuid';
import { slugifyName } from '../../../shared/utils/slug';

@Injectable()
export class TenantRepository {
  private readonly logger = new Logger('TenantRepository');

  constructor(@InjectModel(TenantDoc.name) private readonly model: Model<TenantDoc>) {}

  async create(data: {
    name: string;
    slug: string;
    legalName?: string | null;
    taxCode?: string | null;
    ownerUserId: string;
  }): Promise<TenantDoc> {
    const now = new Date();
    const doc = await this.model.create({
      id: newId(),
      name: data.name,
      slug: data.slug,
      legalName: data.legalName ?? null,
      taxCode: data.taxCode ?? null,
      ownerUserId: data.ownerUserId,
      status: 'active',
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return doc.toObject() as TenantDoc;
  }

  async findBySlug(slug: string): Promise<TenantDoc | null> {
    return this.model
      .findOne({ slug: slug.toLowerCase(), deletedAt: null })
      .lean<TenantDoc>()
      .exec();
  }

  async slugExists(slug: string): Promise<boolean> {
    const c = await this.model.countDocuments({ slug: slug.toLowerCase(), deletedAt: null }).exec();
    return c > 0;
  }

  async findById(id: string): Promise<TenantDoc | null> {
    return this.model.findOne({ id, deletedAt: null }).lean<TenantDoc>().exec();
  }

  async findByOwner(ownerUserId: string): Promise<TenantDoc[]> {
    return this.model.find({ ownerUserId, deletedAt: null }).lean<TenantDoc[]>().exec();
  }

  /**
   * Sinh slug duy nhất chưa tồn tại trong DB.
   * Dùng cho cả create (setupWizard) và backfill (legacy tenants).
   */
  async generateUniqueSlug(name: string): Promise<string> {
    const base = slugifyName(name);
    let candidate = base;
    let suffix = 2;
    while (await this.slugExists(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
      if (suffix > 100) {
        candidate = `${base}-${Date.now().toString(36)}`;
        break;
      }
    }
    return candidate;
  }

  /**
   * Đảm bảo tenant có slug — backfill cho legacy data.
   * Trả về tenant với slug guaranteed.
   *
   * Lazy migration: nếu doc tồn tại nhưng thiếu slug (do tạo trước khi schema có
   * slug field), tự generate + save. Idempotent.
   */
  async ensureSlug(t: TenantDoc): Promise<TenantDoc> {
    if (t.slug) return t;
    const slug = await this.generateUniqueSlug(t.name);
    await this.model
      .updateOne({ id: t.id }, { $set: { slug, updatedAt: new Date() } })
      .exec();
    this.logger.warn(`Backfilled slug "${slug}" for tenant ${t.id} (${t.name})`);
    return { ...t, slug };
  }
}

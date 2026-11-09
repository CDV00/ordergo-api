import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../audit/audit.module';
import { LoyaltyCardDoc } from '../loyalty/schemas/loyalty-card.schema';
import { LoyaltyTxDoc } from '../loyalty/schemas/loyalty-transaction.schema';
import { OrderDoc } from '../order/schemas/order.schema';
import { searchFilter } from './customer-search';
import {
  CustomerListItem,
  CustomerProfile,
  RevealedCustomer,
  toListItem,
  toProfile,
  toRevealed,
} from './customer.mapper';
import { ListCustomersQuery, UpdateCustomerDto } from './dto/customer.dto';
import { CustomerTenantRepository } from './repositories/customer-tenant.repository';
import { CustomerDoc } from './schemas/customer.schema';

/** Giới hạn xem thông tin đầy đủ: 30 lần / người dùng / giờ. */
export const REVEAL_LIMIT_PER_HOUR = 30;
const HOUR_MS = 3_600_000;
const PII_FIELDS = ['name', 'phone', 'email', 'birthday'] as const;

export interface CustomerDetail extends CustomerProfile {
  loyalty: {
    tier: LoyaltyCardDoc['tier'];
    points: number;
    pointsLifetime: number;
    spentLifetime: number;
  } | null;
  transactions: Array<{
    id: string;
    type: LoyaltyTxDoc['type'];
    points: number;
    reason: string;
    referenceType: LoyaltyTxDoc['referenceType'];
    referenceId: string | null;
    balanceAfter: number;
    createdAt: Date;
  }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    total: { amount: number; currency: string };
    status: OrderDoc['status'];
    createdAt: Date;
  }>;
}

/**
 * Quản lý khách hàng + xem thẻ thành viên. PII che mặc định; xem đầy đủ qua `reveal` (audit + giới hạn).
 * KHÔNG log tên/SĐT/email/ngày sinh hay chuỗi tìm kiếm ở bất kỳ đâu trong service này.
 *
 * Loyalty/Order được query thẳng model (lọc `tenantId` từ context) vì LoyaltyModule đã import
 * CustomerModule — import ngược lại sẽ tạo vòng phụ thuộc.
 */
@Injectable()
export class CustomerService {
  constructor(
    private readonly customers: CustomerTenantRepository,
    @InjectModel(LoyaltyCardDoc.name) private readonly cards: Model<LoyaltyCardDoc>,
    @InjectModel(LoyaltyTxDoc.name) private readonly txs: Model<LoyaltyTxDoc>,
    @InjectModel(OrderDoc.name) private readonly orders: Model<OrderDoc>,
    private readonly audit: AuditService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  async list(q: ListCustomersQuery): Promise<{
    data: CustomerListItem[];
    pagination: { page: number; pageSize: number; total: number };
  }> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const filter: Record<string, unknown> = searchFilter(q.q);
    if (q.status) filter.status = q.status;

    const [rows, total] = await Promise.all([
      this.customers.find(filter, {
        sort: { 'stats.lastOrderAt': -1, createdAt: -1, id: -1 },
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }),
      this.customers.count(filter),
    ]);

    const tenantId = this.tenantCtx.tenantId();
    const cards = rows.length
      ? await this.cards
          .find({ tenantId, customerId: { $in: rows.map((r) => r.id) }, deletedAt: null })
          .lean<LoyaltyCardDoc[]>()
          .exec()
      : [];
    const cardOf = new Map(cards.map((c) => [c.customerId, c]));

    return {
      data: rows.map((r) => toListItem(r, cardOf.get(r.id) ?? null)),
      pagination: { page, pageSize, total },
    };
  }

  async get(id: string): Promise<CustomerDetail> {
    const customer = await this.customers.findByIdOrFail(id);
    return this.detail(customer);
  }

  /** Trả PII đầy đủ — kiểm giới hạn trước, ghi audit (không chứa giá trị PII) rồi mới trả. */
  async reveal(id: string): Promise<RevealedCustomer> {
    const used = await this.audit.countRecent('customer.reveal', HOUR_MS);
    if (used >= REVEAL_LIMIT_PER_HOUR) {
      throw new HttpException(
        {
          code: 'REVEAL_LIMIT',
          message: `Bạn đã xem thông tin đầy đủ ${REVEAL_LIMIT_PER_HOUR} lần trong 1 giờ qua. Vui lòng thử lại sau.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const customer = await this.customers.findByIdOrFail(id);
    await this.audit.record({
      action: 'customer.reveal',
      entityType: 'customer',
      entityId: customer.id,
      metadata: { fields: [...PII_FIELDS] },
    });
    return toRevealed(customer);
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerDetail> {
    const customer = await this.customers.findByIdOrFail(id);
    this.assertNotAnonymized(customer);

    const set: Record<string, unknown> = {};
    if (dto.name !== undefined) set.name = dto.name || null;
    if (dto.email !== undefined) set.email = dto.email || null;
    if (dto.birthday !== undefined)
      set.birthday = dto.birthday ? parseBirthday(dto.birthday) : null;
    if (dto.tags !== undefined) set.tags = [...new Set(dto.tags ?? [])];
    if (dto.note !== undefined) set.note = dto.note || null;

    const changed = Object.keys(set).filter((k) => !sameValue(customer, k, set[k]));
    if (changed.length === 0) return this.detail(customer);

    const changes = Object.fromEntries(changed.map((k) => [k, set[k]]));
    const updated = await this.customers.updateById(id, { $set: changes });
    await this.audit.record({
      action: 'customer.update',
      entityType: 'customer',
      entityId: id,
      metadata: { fields: changed },
    });
    return this.detail(updated);
  }

  /**
   * Quyền xoá dữ liệu cá nhân = ẩn danh hoá (KHÔNG soft-delete): xoá tên/SĐT/email/ngày sinh,
   * tag, ghi chú và mọi định danh gián tiếp (userId, cookie, thiết bị); xoá snapshot tên/SĐT
   * trên đơn hàng. Giữ thống kê, thẻ thành viên và đơn hàng cho báo cáo.
   */
  async anonymize(id: string): Promise<CustomerDetail> {
    const customer = await this.customers.findByIdOrFail(id);
    const now = new Date();
    const updated = await this.customers.updateById(customer.id, {
      $set: {
        status: 'anonymous',
        name: null,
        phone: null,
        email: null,
        birthday: null,
        tags: [],
        note: null,
        userId: null,
        cookieAnchor: null,
        deviceFingerprints: [],
        dataErasureRequestedAt: customer.dataErasureRequestedAt ?? now,
      },
    });
    const tenantId = this.tenantCtx.tenantId();
    const orders = await this.orders
      .updateMany(
        { tenantId, customerId: customer.id, customerSnapshot: { $ne: null } },
        { $set: { customerSnapshot: null, updatedAt: now } },
      )
      .exec();
    await this.audit.record({
      action: 'customer.anonymize',
      entityType: 'customer',
      entityId: customer.id,
      metadata: { ordersScrubbed: orders.modifiedCount },
    });
    return this.detail(updated);
  }

  private async detail(customer: CustomerDoc): Promise<CustomerDetail> {
    const tenantId = this.tenantCtx.tenantId();
    const [card, txs, orders] = await Promise.all([
      this.cards
        .findOne({ tenantId, customerId: customer.id, deletedAt: null })
        .lean<LoyaltyCardDoc>()
        .exec(),
      this.txs
        .find({ tenantId, customerId: customer.id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean<LoyaltyTxDoc[]>()
        .exec(),
      this.orders
        .find({ tenantId, customerId: customer.id, deletedAt: null })
        .sort({ createdAt: -1 })
        .limit(10)
        .select({ id: 1, orderNumber: 1, pricing: 1, status: 1, createdAt: 1 })
        .lean<OrderDoc[]>()
        .exec(),
    ]);

    return {
      ...toProfile(customer),
      loyalty: card
        ? {
            tier: card.tier,
            points: card.points,
            pointsLifetime: card.pointsLifetime,
            spentLifetime: card.spentLifetime,
          }
        : null,
      transactions: txs.map((t) => ({
        id: t.id,
        type: t.type,
        points: t.points,
        reason: t.reason,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        balanceAfter: t.balanceAfter,
        createdAt: t.createdAt,
      })),
      recentOrders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        total: o.pricing?.total ?? { amount: 0, currency: 'VND' },
        status: o.status,
        createdAt: o.createdAt,
      })),
    };
  }

  private assertNotAnonymized(c: CustomerDoc): void {
    if (c.dataErasureRequestedAt) {
      throw new ConflictException({
        code: 'CUSTOMER_ANONYMIZED',
        message: 'Khách này đã được xoá dữ liệu cá nhân, không thể sửa hồ sơ.',
      });
    }
  }
}

/** "YYYY-MM-DD" → Date (UTC 00:00). Chặn ngày tương lai / trước 1900. */
export function parseBirthday(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  const valid =
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === s &&
    d.getUTCFullYear() >= 1900 &&
    d.getTime() <= Date.now();
  if (!valid) {
    throw new BadRequestException({
      code: 'INVALID_BIRTHDAY',
      message: 'Ngày sinh không hợp lệ.',
    });
  }
  return d;
}

function sameValue(c: CustomerDoc, key: string, next: unknown): boolean {
  const cur = (c as unknown as Record<string, unknown>)[key] ?? null;
  if (next instanceof Date || cur instanceof Date) {
    const a = cur ? new Date(cur as Date).getTime() : null;
    const b = next ? (next as Date).getTime() : null;
    return a === b;
  }
  if (Array.isArray(next)) {
    return Array.isArray(cur) && cur.length === next.length && cur.every((v, i) => v === next[i]);
  }
  return cur === next;
}

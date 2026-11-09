import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { OrderDoc } from '../order/schemas/order.schema';
import { PaymentDoc } from '../payment/schemas/payment.schema';
import { UserDoc } from '../identity/schemas/user.schema';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { MembershipRepository } from '../tenant/repositories/membership.repository';
import { AuditService } from '../audit/audit.module';
import { maskName } from '../../shared/utils/mask';
import { formatStamp, resolveRange, ReportRange, zeroFillDaily } from './report-range';
import { buildSalesCsv } from './sales-report.csv';
import type { SalesReport } from './sales-report.types';
import { buildByVenue, ReportScope, ReportScopeService } from './report-scope';
import type { VenueDoc } from '../tenant/schemas/venue.schema';

/** Trạng thái payment được tính là "đã thu" (refunded vẫn tính, phần hoàn trừ riêng). */
const COLLECTED_STATUSES = ['succeeded', 'partially_refunded', 'refunded'];
export const EXPORT_ACTION = 'report.export';
export const EXPORT_LIMIT_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

interface Bucket {
  _id: string | number | null;
  amount?: number;
  count?: number;
}

const toMap = <K extends string | number>(rows: Bucket[], field: 'amount' | 'count') =>
  new Map<K, number>(rows.map((r) => [r._id as K, r[field] ?? 0]));

@Injectable()
export class SalesReportService {
  constructor(
    @InjectModel(OrderDoc.name) private readonly orderModel: Model<OrderDoc>,
    @InjectModel(PaymentDoc.name) private readonly paymentModel: Model<PaymentDoc>,
    @InjectModel(UserDoc.name) private readonly userModel: Model<UserDoc>,
    private readonly tenantCtx: TenantContextService,
    private readonly scopes: ReportScopeService,
    private readonly memberships: MembershipRepository,
    private readonly audit: AuditService,
  ) {}

  /** `venueId=all` → gộp mọi cơ sở (chỉ người có quyền toàn chuỗi) + `byVenue[]`. */
  async salesReport(venueId?: string | null, from?: string, to?: string): Promise<SalesReport> {
    const v = await this.scopes.resolve(venueId);
    const range = resolveRange(from, to, v.timezone);
    return this.build(v, range);
  }

  /** Xuất CSV: kiểm giới hạn TRƯỚC khi dựng, ghi audit, đóng dấu người xuất (tên đã che). */
  async exportCsv(
    venueId?: string | null,
    from?: string,
    to?: string,
  ): Promise<{ filename: string; content: string }> {
    const v = await this.scopes.resolve(venueId);
    const range = resolveRange(from, to, v.timezone);

    const recent = await this.audit.countRecent(EXPORT_ACTION, HOUR_MS);
    if (recent >= EXPORT_LIMIT_PER_HOUR) {
      throw new HttpException(
        {
          code: 'EXPORT_LIMIT',
          message: `Bạn đã xuất báo cáo ${EXPORT_LIMIT_PER_HOUR} lần trong 1 giờ qua. Vui lòng thử lại sau.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const report = await this.build(v, range);
    const operator = await this.userModel
      .findOne({ id: this.tenantCtx.userId() }, { displayName: 1 })
      .lean<Pick<UserDoc, 'displayName'>>()
      .exec();
    const stampLine = `Xuất bởi: ${maskName(operator?.displayName) ?? '—'} · ${formatStamp(new Date(), v.timezone)}`;
    const { content, rows } = buildSalesCsv(report, {
      venueName: v.all ? 'Tất cả cơ sở' : (v.venue?.name ?? null),
      stampLine,
    });

    await this.audit.record({
      action: EXPORT_ACTION,
      entityType: 'sales_report',
      entityId: v.venueId,
      metadata: v.all
        ? { from: range.from, to: range.to, rows, venues: v.venues.length }
        : { from: range.from, to: range.to, rows },
    });

    return { filename: `bao-cao-${range.from}_${range.to}.csv`, content };
  }

  private async build(v: ReportScope, range: ReportRange): Promise<SalesReport> {
    const { venueId, timezone } = v;
    const allVenues: VenueDoc[] | null = v.all ? v.venues : null;
    const tenantId = this.tenantCtx.tenantId();
    // Chỉ khi xem toàn chuỗi mới cần tách theo cơ sở
    const byVenueFacet = (facet: Record<string, unknown>) =>
      allVenues ? { byVenue: [{ $group: { _id: '$venueId', ...facet } }] } : {};
    const scope: Record<string, unknown> = { tenantId, deletedAt: null };
    if (venueId) scope.venueId = venueId;
    const day = (field: string) => ({
      $dateToString: { format: '%Y-%m-%d', date: field, timezone },
    });
    const hour = (field: string) => ({ $hour: { date: field, timezone } });
    const inRange = { $gte: range.start, $lte: range.end };

    const [payments, refunds, orders] = await Promise.all([
      this.paymentModel
        .aggregate<Record<string, Bucket[]>>([
          { $match: { ...scope, status: { $in: COLLECTED_STATUSES }, receivedAt: inRange } },
          {
            $facet: {
              total: [{ $group: { _id: null, amount: { $sum: '$amount.amount' } } }],
              byDay: [{ $group: { _id: day('$receivedAt'), amount: { $sum: '$amount.amount' } } }],
              byHour: [
                { $group: { _id: hour('$receivedAt'), amount: { $sum: '$amount.amount' } } },
              ],
              byMethod: [
                {
                  $group: {
                    _id: '$method',
                    amount: { $sum: '$amount.amount' },
                    count: { $sum: 1 },
                  },
                },
              ],
              byStaff: [
                {
                  $group: {
                    _id: '$receivedBy',
                    amount: { $sum: '$amount.amount' },
                    count: { $sum: 1 },
                  },
                },
              ],
              ...byVenueFacet({ amount: { $sum: '$amount.amount' } }),
            },
          },
        ] as PipelineStage[])
        .exec(),
      this.paymentModel
        .aggregate<Record<string, Bucket[]>>([
          { $match: { ...scope, 'refunds.refundedAt': inRange } },
          { $unwind: '$refunds' },
          { $match: { 'refunds.refundedAt': inRange } },
          {
            $facet: {
              total: [{ $group: { _id: null, amount: { $sum: '$refunds.amount.amount' } } }],
              byDay: [
                {
                  $group: {
                    _id: day('$refunds.refundedAt'),
                    amount: { $sum: '$refunds.amount.amount' },
                  },
                },
              ],
              byHour: [
                {
                  $group: {
                    _id: hour('$refunds.refundedAt'),
                    amount: { $sum: '$refunds.amount.amount' },
                  },
                },
              ],
              byMethod: [
                { $group: { _id: '$method', amount: { $sum: '$refunds.amount.amount' } } },
              ],
              ...byVenueFacet({ amount: { $sum: '$refunds.amount.amount' } }),
            },
          },
        ] as PipelineStage[])
        .exec(),
      this.orderModel
        .aggregate<Record<string, Bucket[] & Array<Record<string, unknown>>>>([
          { $match: { ...scope, createdAt: inRange } },
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    orders: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] } },
                    cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
                    gross: {
                      $sum: {
                        $cond: [{ $ne: ['$status', 'cancelled'] }, '$pricing.total.amount', 0],
                      },
                    },
                    discount: {
                      $sum: {
                        $cond: [{ $ne: ['$status', 'cancelled'] }, '$pricing.discount.amount', 0],
                      },
                    },
                    serviceCharge: {
                      $sum: {
                        $cond: [
                          { $ne: ['$status', 'cancelled'] },
                          '$pricing.serviceCharge.amount',
                          0,
                        ],
                      },
                    },
                  },
                },
              ],
              byDay: [
                { $match: { status: { $ne: 'cancelled' } } },
                { $group: { _id: day('$createdAt'), count: { $sum: 1 } } },
              ],
              byHour: [
                { $match: { status: { $ne: 'cancelled' } } },
                { $group: { _id: hour('$createdAt'), count: { $sum: 1 } } },
              ],
              byCreator: [
                { $match: { status: { $ne: 'cancelled' } } },
                { $group: { _id: '$createdBy', count: { $sum: 1 } } },
              ],
              topItems: [
                { $match: { status: 'paid' } },
                { $sort: { createdAt: 1 } },
                { $unwind: '$lines' },
                { $match: { 'lines.kitchenStatus': { $ne: 'cancelled' } } },
                {
                  $group: {
                    _id: '$lines.productId',
                    name: { $last: '$lines.productSnapshot.name' },
                    quantity: { $sum: '$lines.quantity' },
                    revenue: { $sum: '$lines.lineTotal.amount' },
                  },
                },
                { $sort: { quantity: -1, revenue: -1, _id: 1 } },
                { $limit: 20 },
              ],
              ...(allVenues
                ? {
                    byVenue: [
                      { $match: { status: { $ne: 'cancelled' } } },
                      {
                        $group: {
                          _id: '$venueId',
                          count: { $sum: 1 },
                          amount: { $sum: '$pricing.total.amount' },
                        },
                      },
                    ],
                  }
                : {}),
            },
          },
        ] as PipelineStage[])
        .exec(),
    ]);

    const p = payments[0] ?? {};
    const r = refunds[0] ?? {};
    const o = (orders[0] ?? {}) as Record<string, Array<Record<string, unknown>>>;
    const num = (x: unknown) => (typeof x === 'number' ? x : 0);

    const collected = num(p.total?.[0]?.amount);
    const refunded = num(r.total?.[0]?.amount);
    const ot = o.totals?.[0] ?? {};
    const orderCount = num(ot.orders);
    const gross = num(ot.gross);

    // Doanh thu theo ngày/giờ = thu − hoàn (theo thời điểm hoàn).
    const netBy = <K extends string | number>(a: Bucket[] = [], b: Bucket[] = []) => {
      const m = toMap<K>(a, 'amount');
      for (const [k, v] of toMap<K>(b, 'amount')) m.set(k, (m.get(k) ?? 0) - v);
      return m;
    };
    const revenueByDay = netBy<string>(p.byDay, r.byDay);
    const revenueByHour = netBy<number>(p.byHour, r.byHour);
    const ordersByDay = toMap<string>((o.byDay ?? []) as unknown as Bucket[], 'count');
    const ordersByHour = toMap<number>((o.byHour ?? []) as unknown as Bucket[], 'count');

    const refundByMethod = toMap<string>(r.byMethod ?? [], 'amount');
    const methods = new Set<string>([
      ...(p.byMethod ?? []).map((m) => String(m._id)),
      ...refundByMethod.keys(),
    ]);
    const paidByMethod = new Map((p.byMethod ?? []).map((m) => [String(m._id), m]));
    const byPaymentMethod = [...methods]
      .map((method) => {
        const refundedM = refundByMethod.get(method) ?? 0;
        return {
          method,
          amount: num(paidByMethod.get(method)?.amount) - refundedM,
          refunded: refundedM,
          count: num(paidByMethod.get(method)?.count),
        };
      })
      .sort((a, b) => b.amount - a.amount);

    const byStaff = await this.staffBreakdown(
      tenantId,
      p.byStaff ?? [],
      (o.byCreator ?? []) as unknown as Bucket[],
    );

    const byVenue = allVenues
      ? buildByVenue(
          allVenues,
          netBy<string>(p.byVenue, r.byVenue),
          new Map(
            ((o.byVenue ?? []) as unknown as Bucket[]).map((b) => [
              String(b._id),
              { count: b.count ?? 0, gross: b.amount ?? 0 },
            ]),
          ),
        )
      : undefined;

    return {
      venueId: v.all ? 'all' : venueId,
      timezone,
      from: range.from,
      to: range.to,
      currency: 'VND',
      totals: {
        netRevenue: collected - refunded,
        collected,
        refunds: refunded,
        grossOrderValue: gross,
        orders: orderCount,
        cancelledOrders: num(ot.cancelled),
        averageTicket: orderCount ? Math.round(gross / orderCount) : 0,
        discountTotal: num(ot.discount),
        serviceChargeTotal: num(ot.serviceCharge),
      },
      daily: zeroFillDaily(range.days, revenueByDay, ordersByDay),
      byPaymentMethod,
      topItems: (o.topItems ?? []).map((i) => ({
        menuItemId: String(i._id),
        name: typeof i.name === 'string' ? i.name : '',
        quantity: num(i.quantity),
        revenue: num(i.revenue),
      })),
      byHour: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        orders: ordersByHour.get(h) ?? 0,
        revenue: revenueByHour.get(h) ?? 0,
      })),
      byStaff,
      ...(byVenue ? { byVenue } : {}),
    };
  }

  /**
   * Gộp thu tiền (payments.receivedBy) + tạo đơn (orders.createdBy) theo nhân viên.
   * Chỉ hiện tên người có membership trong tenant — người khác (vd khách QR) gộp vào 1 dòng,
   * tránh lộ tên khách hàng. Chỉ đọc `displayName`, KHÔNG BAO GIỜ đọc/trả SĐT.
   */
  private async staffBreakdown(
    tenantId: string,
    paid: Bucket[],
    created: Bucket[],
  ): Promise<SalesReport['byStaff']> {
    const members = new Set((await this.memberships.findByTenant(tenantId)).map((m) => m.userId));
    const OTHER = '__other__';
    const rows = new Map<
      string,
      { paymentsCount: number; paymentsAmount: number; ordersCreated: number }
    >();
    const row = (id: unknown) => {
      const key = typeof id === 'string' && members.has(id) ? id : OTHER;
      const cur = rows.get(key) ?? { paymentsCount: 0, paymentsAmount: 0, ordersCreated: 0 };
      rows.set(key, cur);
      return cur;
    };
    for (const b of paid) {
      const cur = row(b._id);
      cur.paymentsCount += b.count ?? 0;
      cur.paymentsAmount += b.amount ?? 0;
    }
    for (const b of created) row(b._id).ordersCreated += b.count ?? 0;

    const ids = [...rows.keys()].filter((k) => k !== OTHER);
    const users = ids.length
      ? await this.userModel
          .find({ id: { $in: ids } }, { _id: 0, id: 1, displayName: 1 })
          .lean<Array<Pick<UserDoc, 'id' | 'displayName'>>>()
          .exec()
      : [];
    const names = new Map(users.map((u) => [u.id, u.displayName]));

    return [...rows.entries()]
      .map(([key, v]) => ({
        userId: key === OTHER ? null : key,
        displayName:
          key === OTHER ? 'Khác (khách tự gọi/không rõ)' : (names.get(key) ?? 'Nhân viên đã xoá'),
        ...v,
      }))
      .sort((a, b) => b.paymentsAmount - a.paymentsAmount || b.ordersCreated - a.ordersCreated);
  }
}

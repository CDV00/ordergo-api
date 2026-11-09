import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderDoc } from '../order/schemas/order.schema';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { dayRange, hourIn } from '../../shared/utils/time';
import { buildByVenue, ReportScopeService, VenueBreakdownRow } from './report-scope';

export interface DailySalesSummary {
  date: string;
  venueId: string | null;
  orders: { count: number; cancelledCount: number };
  revenue: { gross: number; net: number; currency: 'VND' };
  byPaymentStatus: { paid: number; pending: number };
  byHour: Array<{ hour: number; orderCount: number; revenue: number }>;
  topItems: Array<{ menuItemId: string; name: string; quantity: number; revenue: number }>;
  /** Chỉ có khi `venueId=all`: revenue = đã thu (đơn paid) theo từng chi nhánh. */
  byVenue?: VenueBreakdownRow[];
}

@Injectable()
export class ReportingService {
  constructor(
    @InjectModel(OrderDoc.name) private readonly orderModel: Model<OrderDoc>,
    private readonly tenantCtx: TenantContextService,
    private readonly scopes: ReportScopeService,
  ) {}

  /**
   * Tổng hợp doanh thu 1 ngày (YYYY-MM-DD, mặc định hôm nay) theo múi giờ của cơ sở.
   * `venueId=all` → gộp mọi cơ sở (chỉ quyền toàn chuỗi) + `byVenue[]`.
   */
  async dailySummary(venueId?: string | null, date?: string | null): Promise<DailySalesSummary> {
    const tenantId = this.tenantCtx.tenantId();
    const scope = await this.scopes.resolve(venueId);
    const timezone = scope.timezone;
    const { ymd, start, end } = dayRange(date, timezone);

    const filter: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      createdAt: { $gte: start, $lte: end },
    };
    if (scope.venueId) filter.venueId = scope.venueId;
    const paidByVenue = new Map<string, number>();
    const ordersByVenue = new Map<string, { count: number; gross: number }>();

    const orders = await this.orderModel
      .find(filter as any)
      .lean<OrderDoc[]>()
      .exec();

    let cancelledCount = 0;
    let gross = 0;
    let paid = 0;
    let pending = 0;
    const hourMap = new Map<number, { orderCount: number; revenue: number }>();
    const itemMap = new Map<
      string,
      { menuItemId: string; name: string; quantity: number; revenue: number }
    >();

    for (const o of orders) {
      if (o.status === 'cancelled') {
        cancelledCount++;
        continue;
      }
      gross += o.pricing.total.amount;
      if (o.status === 'paid') paid += o.pricing.total.amount;
      else pending += o.pricing.total.amount;
      if (scope.all) {
        const v = ordersByVenue.get(o.venueId) ?? { count: 0, gross: 0 };
        v.count += 1;
        v.gross += o.pricing.total.amount;
        ordersByVenue.set(o.venueId, v);
        if (o.status === 'paid') {
          paidByVenue.set(o.venueId, (paidByVenue.get(o.venueId) ?? 0) + o.pricing.total.amount);
        }
      }

      const h = hourIn(new Date(o.createdAt), timezone);
      const cur = hourMap.get(h) ?? { orderCount: 0, revenue: 0 };
      cur.orderCount += 1;
      cur.revenue += o.pricing.total.amount;
      hourMap.set(h, cur);

      for (const l of o.lines) {
        if (l.kitchenStatus === 'cancelled') continue;
        const key = l.productId;
        const cur2 = itemMap.get(key) ?? {
          menuItemId: key,
          name: l.productSnapshot.name,
          quantity: 0,
          revenue: 0,
        };
        cur2.quantity += l.quantity;
        cur2.revenue += l.lineTotal.amount;
        itemMap.set(key, cur2);
      }
    }

    const byHour = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      orderCount: hourMap.get(h)?.orderCount ?? 0,
      revenue: hourMap.get(h)?.revenue ?? 0,
    }));

    const topItems = Array.from(itemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    return {
      date: ymd,
      venueId: scope.all ? 'all' : scope.venueId,
      orders: {
        count: orders.length - cancelledCount,
        cancelledCount,
      },
      revenue: { gross, net: paid, currency: 'VND' },
      byPaymentStatus: { paid, pending },
      byHour,
      topItems,
      ...(scope.all ? { byVenue: buildByVenue(scope.venues, paidByVenue, ordersByVenue) } : {}),
    };
  }
}

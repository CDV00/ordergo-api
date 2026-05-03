import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderDoc } from '../order/schemas/order.schema';
import { TenantContextService } from '../../common/context/tenant-context.service';

export interface DailySalesSummary {
  date: string;
  venueId: string | null;
  orders: { count: number; cancelledCount: number };
  revenue: { gross: number; net: number; currency: 'VND' };
  byPaymentStatus: { paid: number; pending: number };
  byHour: Array<{ hour: number; orderCount: number; revenue: number }>;
  topItems: Array<{ menuItemId: string; name: string; quantity: number; revenue: number }>;
}

@Injectable()
export class ReportingService {
  constructor(
    @InjectModel(OrderDoc.name) private readonly orderModel: Model<OrderDoc>,
    private readonly tenantCtx: TenantContextService,
  ) {}

  async todaySummary(venueId?: string | null): Promise<DailySalesSummary> {
    const tenantId = this.tenantCtx.tenantId();
    const now = new Date();
    // Lấy 0h hôm nay theo timezone server (cần i18n sau — hardcode UTC+7 cho VN)
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    const filter: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      createdAt: { $gte: start, $lte: end },
    };
    if (venueId) filter.venueId = venueId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      const h = new Date(o.createdAt).getHours();
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
      date: start.toISOString().substring(0, 10),
      venueId: venueId ?? null,
      orders: {
        count: orders.length - cancelledCount,
        cancelledCount,
      },
      revenue: { gross, net: paid, currency: 'VND' },
      byPaymentStatus: { paid, pending },
      byHour,
      topItems,
    };
  }
}

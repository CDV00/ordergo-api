import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { VenueRepository } from '../tenant/repositories/venue.repository';
import { canAccessVenue, TenantAccessService } from '../tenant/tenant-access.service';
import type { VenueDoc } from '../tenant/schemas/venue.schema';
import { DEFAULT_TIMEZONE } from '../../shared/utils/time';

/** Giá trị `venueId` để xem gộp mọi cơ sở của tenant (chỉ người có quyền toàn chuỗi). */
export const ALL_VENUES = 'all';

/** 1 dòng "Theo chi nhánh" — số tiền nguyên VND. */
export interface VenueBreakdownRow {
  venueId: string;
  venueName: string;
  revenue: number;
  orders: number;
  /** Tổng giá trị đơn (không huỷ) / số đơn, làm tròn. */
  averageTicket: number;
}

export type ReportScope =
  | { all: false; venueId: string | null; venue: VenueDoc | null; timezone: string }
  | { all: true; venueId: null; venues: VenueDoc[]; timezone: string };

function venueDenied(venueId: string | null): ForbiddenException {
  return new ForbiddenException({
    code: 'VENUE_ACCESS_DENIED',
    message: 'Bạn không có quyền truy cập cơ sở này.',
    details: { venueId },
  });
}

/**
 * Múi giờ chung của mọi cơ sở — báo cáo gộp chia ngày/giờ theo 1 múi giờ duy nhất.
 * Các cơ sở khác múi giờ → 400 MIXED_TIMEZONES (xem từng cơ sở riêng). Không có cơ sở → mặc định.
 */
export function commonTimezone(venues: Array<{ timezone?: string | null }>): string {
  const zones = new Set(venues.map((v) => v.timezone || DEFAULT_TIMEZONE));
  if (zones.size > 1) {
    throw new BadRequestException({
      code: 'MIXED_TIMEZONES',
      message: 'Các cơ sở dùng múi giờ khác nhau — vui lòng xem báo cáo từng cơ sở.',
      details: { timezones: [...zones] },
    });
  }
  const [only] = [...zones];
  return only ?? DEFAULT_TIMEZONE;
}

/**
 * Gộp số liệu theo cơ sở thành `byVenue[]`: mọi cơ sở đều có dòng (kể cả 0đ), cơ sở đã xoá
 * nhưng còn số liệu vẫn hiện. Sắp theo doanh thu giảm dần, rồi theo thứ tự cơ sở.
 */
export function buildByVenue(
  venues: Array<Pick<VenueDoc, 'id' | 'name'>>,
  revenueByVenue: Map<string, number>,
  ordersByVenue: Map<string, { count: number; gross: number }>,
): VenueBreakdownRow[] {
  const names = new Map(venues.map((v) => [v.id, v.name]));
  const ids = [
    ...venues.map((v) => v.id),
    ...[...revenueByVenue.keys(), ...ordersByVenue.keys()].filter((id) => !names.has(id)),
  ];
  const order = new Map([...new Set(ids)].map((id, i) => [id, i]));
  return [...order.keys()]
    .map((id) => {
      const o = ordersByVenue.get(id) ?? { count: 0, gross: 0 };
      return {
        venueId: id,
        venueName: names.get(id) ?? 'Cơ sở đã xoá',
        revenue: revenueByVenue.get(id) ?? 0,
        orders: o.count,
        averageTicket: o.count ? Math.round(o.gross / o.count) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || order.get(a.venueId)! - order.get(b.venueId)!);
}

/**
 * Quyết định phạm vi báo cáo cho 1 request:
 *  - `venueId=all` → mọi cơ sở của tenant; chỉ membership toàn tenant (owner/tenant_admin/kế toán),
 *    người gắn cơ sở → 403 VENUE_ACCESS_DENIED; các cơ sở phải cùng múi giờ.
 *  - Ngược lại venue = query ?? venue của context (header). Khác venue context thì user phải có
 *    quyền ở venue đó (toàn tenant hoặc được gắn); venue phải thuộc tenant (404 nếu không).
 */
@Injectable()
export class ReportScopeService {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly venues: VenueRepository,
    private readonly access: TenantAccessService,
  ) {}

  async resolve(venueId?: string | null): Promise<ReportScope> {
    const ctx = this.tenantCtx.required();
    const scope = () => this.access.venueScope(this.tenantCtx.userId(), this.tenantCtx.tenantId());

    if (venueId === ALL_VENUES) {
      if (!(await scope()).tenantWide) throw venueDenied(ALL_VENUES);
      const venues = await this.venues.find({}, { sort: { createdAt: 1 } });
      return { all: true, venueId: null, venues, timezone: commonTimezone(venues) };
    }

    const id = venueId || ctx.venueId || null;
    // ctx.venueId = null chỉ xảy ra với membership toàn tenant (TenantAccessService).
    if (id && ctx.venueId && id !== ctx.venueId && !canAccessVenue(await scope(), id)) {
      throw venueDenied(id);
    }
    const venue = id ? await this.venues.findByIdOrFail(id) : null;
    return { all: false, venueId: id, venue, timezone: venue?.timezone || DEFAULT_TIMEZONE };
  }
}

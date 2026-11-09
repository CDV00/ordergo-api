import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShiftRepository } from './repositories/shift.repository';
import { ShiftDoc, ShiftSummary } from './schemas/shift.schema';
import { CloseShiftDto, ListShiftsQuery, OpenShiftDto } from './dto/shift.dto';
import { computeShiftSummary, expectedCashOf, shiftYmd } from './shift-summary';
import { PaymentRepository } from '../payment/repositories/payment.repository';
import { PaymentDoc } from '../payment/schemas/payment.schema';
import { VenueRepository } from '../tenant/repositories/venue.repository';
import { UserRepository } from '../identity/repositories/user.repository';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { hasPermission } from '../../common/auth/permissions';
import { AuditService } from '../audit/audit.module';
import { dayRange, DEFAULT_TIMEZONE, todayYmd } from '../../shared/utils/time';

/** Ca trả về client: kèm tên hiển thị người mở/đóng ca (không trả SĐT). */
export type ShiftView = ShiftDoc & {
  openedByName: string | null;
  closedByName: string | null;
};

export type ShiftDetail = ShiftView & { payments: PaymentDoc[] };

/** Khoảng tối đa của danh sách ca (ngày). */
const MAX_RANGE_DAYS = 92;

@Injectable()
export class ShiftService {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly payments: PaymentRepository,
    private readonly venues: VenueRepository,
    private readonly users: UserRepository,
    private readonly tenantCtx: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /** Ca đang mở của cơ sở + số liệu tạm tính đến hiện tại, hoặc null. */
  async current(venueId?: string): Promise<ShiftView | null> {
    if (!this.can('shift.open') && !this.can('shift.close')) throw this.forbidden();
    const vid = this.resolveVenueId(venueId);
    await this.assertVenue(vid);
    const shift = await this.shifts.findOpen(vid);
    if (!shift) return null;
    return this.toView(await this.withLiveSummary(shift));
  }

  async open(dto: OpenShiftDto): Promise<ShiftView> {
    await this.assertVenue(dto.venueId);
    if (await this.shifts.findOpen(dto.venueId)) throw this.alreadyOpen();
    let shift: ShiftDoc;
    try {
      shift = await this.shifts.create({
        venueId: dto.venueId,
        status: 'open',
        openedBy: this.tenantCtx.userId(),
        openedAt: new Date(),
        openingCash: dto.openingCash,
        closedBy: null,
        closedAt: null,
        countedCash: null,
        expectedCash: null,
        difference: null,
        note: dto.note?.trim() || null,
        summary: null,
      });
    } catch (err) {
      // Hai máy mở ca cùng lúc → unique index partial chặn bản ghi thứ hai.
      if ((err as { code?: number }).code === 11000) throw this.alreadyOpen();
      throw err;
    }
    await this.audit.record({
      action: 'shift.open',
      entityType: 'shift',
      entityId: shift.id,
      metadata: { openingCash: shift.openingCash },
    });
    return this.toView(await this.withLiveSummary(shift));
  }

  async close(id: string, dto: CloseShiftDto): Promise<ShiftView> {
    const shift = await this.shifts.findByIdOrFail(id);
    this.assertVenueContext(shift.venueId);
    if (shift.status !== 'open') throw this.notOpen();

    const closedAt = new Date();
    const summary = await this.summaryFor(shift, closedAt);
    const expectedCash = expectedCashOf(shift.openingCash, summary);
    const difference = dto.countedCash - expectedCash;
    const note = dto.note?.trim() || null;
    if (difference !== 0 && !note) {
      throw new BadRequestException({
        code: 'NOTE_REQUIRED_FOR_DIFFERENCE',
        message: 'Tiền đếm lệch với tiền dự kiến — vui lòng ghi chú lý do.',
        details: { expectedCash, countedCash: dto.countedCash, difference },
      });
    }

    const closed = await this.shifts.closeIfOpen(id, {
      status: 'closed',
      closedBy: this.tenantCtx.userId(),
      closedAt,
      countedCash: dto.countedCash,
      expectedCash,
      difference,
      note: note ?? shift.note,
      summary,
    });
    if (!closed) throw this.notOpen();

    await this.audit.record({
      action: 'shift.close',
      entityType: 'shift',
      entityId: id,
      metadata: {
        openingCash: shift.openingCash,
        countedCash: dto.countedCash,
        expectedCash,
        difference,
      },
    });
    return this.toView(closed);
  }

  /** Danh sách ca theo ngày mở ca (giờ của cơ sở). Không có shift.manage → chỉ ca của mình. */
  async list(q: ListShiftsQuery): Promise<ShiftView[]> {
    const vid = q.venueId ?? this.tenantCtx.current()?.venueId ?? null;
    let timezone = DEFAULT_TIMEZONE;
    if (vid) {
      const venue = await this.assertVenue(vid);
      timezone = venue.timezone ?? DEFAULT_TIMEZONE;
    }
    const to = q.to ?? todayYmd(timezone);
    let from = q.from ?? shiftYmd(to, -6);
    if (from > to) from = to;
    if (from < shiftYmd(to, -MAX_RANGE_DAYS)) from = shiftYmd(to, -MAX_RANGE_DAYS);

    const filter: Record<string, unknown> = {
      openedAt: { $gte: dayRange(from, timezone).start, $lte: dayRange(to, timezone).end },
    };
    if (vid) filter.venueId = vid;
    if (!this.can('shift.manage')) {
      const uid = this.tenantCtx.userId();
      filter.$or = [{ openedBy: uid }, { closedBy: uid }];
    }
    const rows = await this.shifts.find(filter, { sort: { openedAt: -1 }, limit: 500 });
    const live = await Promise.all(rows.map((s) => this.withLiveSummary(s)));
    return this.toViews(live);
  }

  /** Chi tiết ca + danh sách khoản thu gắn với ca. */
  async get(id: string): Promise<ShiftDetail> {
    const shift = await this.shifts.findByIdOrFail(id);
    this.assertVenueContext(shift.venueId);
    const uid = this.tenantCtx.userId();
    const own = shift.openedBy === uid || shift.closedBy === uid;
    if (!this.can('shift.manage') && !own && shift.status !== 'open') {
      // Không tiết lộ ca của người khác.
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy bản ghi.',
        details: { id },
      });
    }
    const payments = await this.payments.find(
      { shiftId: shift.id },
      { sort: { receivedAt: 1 }, limit: 2000 },
    );
    const view = await this.toView(await this.withLiveSummary(shift));
    return { ...view, payments };
  }

  // ─── Nội bộ ───

  /** Ca đang mở: tính summary + tiền dự kiến đến hiện tại (chưa lưu). Ca đã đóng: giữ nguyên. */
  private async withLiveSummary(shift: ShiftDoc): Promise<ShiftDoc> {
    if (shift.status !== 'open') return shift;
    const summary = await this.summaryFor(shift, new Date());
    return { ...shift, summary, expectedCash: expectedCashOf(shift.openingCash, summary) };
  }

  private async summaryFor(shift: ShiftDoc, to: Date): Promise<ShiftSummary> {
    const from = shift.openedAt;
    const [shiftPayments, refundCandidates] = await Promise.all([
      this.payments.find({ shiftId: shift.id }),
      this.payments.find({
        venueId: shift.venueId,
        'refunds.refundedAt': { $gte: from, $lte: to },
      }),
    ]);
    return computeShiftSummary(shiftPayments, refundCandidates, { from, to });
  }

  private async toView(shift: ShiftDoc): Promise<ShiftView> {
    return (await this.toViews([shift]))[0];
  }

  private async toViews(shifts: ShiftDoc[]): Promise<ShiftView[]> {
    const ids = new Set<string>();
    for (const s of shifts) {
      ids.add(s.openedBy);
      if (s.closedBy) ids.add(s.closedBy);
    }
    const names = new Map<string, string>();
    await Promise.all(
      [...ids].map(async (uid) => {
        const user = await this.users.findById(uid);
        if (user) names.set(uid, user.displayName);
      }),
    );
    return shifts.map((s) => {
      // Bỏ _id/__v của Mongo khỏi response.
      const { _id, __v, ...rest } = s as ShiftDoc & { _id?: unknown; __v?: unknown };
      void _id;
      void __v;
      return {
        ...(rest as ShiftDoc),
        openedByName: names.get(s.openedBy) ?? null,
        closedByName: s.closedBy ? (names.get(s.closedBy) ?? null) : null,
      };
    });
  }

  private can(permission: string): boolean {
    return hasPermission(this.tenantCtx.current()?.permissions ?? [], permission);
  }

  private resolveVenueId(venueId?: string): string {
    const vid = venueId ?? this.tenantCtx.current()?.venueId ?? null;
    if (!vid) {
      throw new BadRequestException({
        code: 'VENUE_REQUIRED',
        message: 'Vui lòng chọn cơ sở.',
      });
    }
    return vid;
  }

  /** Venue phải thuộc tenant (404 nếu không) và khớp venue đang thao tác. */
  private async assertVenue(venueId: string) {
    const venue = await this.venues.findByIdOrFail(venueId);
    this.assertVenueContext(venueId);
    return venue;
  }

  /** Request đã chọn venue (X-Venue-Id / venue gắn membership) thì không được thao tác venue khác. */
  private assertVenueContext(venueId: string): void {
    const ctxVenue = this.tenantCtx.current()?.venueId ?? null;
    if (ctxVenue && ctxVenue !== venueId) {
      throw new ForbiddenException({
        code: 'VENUE_ACCESS_DENIED',
        message: 'Bạn không có quyền truy cập cơ sở này.',
        details: { venueId },
      });
    }
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Bạn không có quyền thực hiện thao tác này.',
    });
  }

  private alreadyOpen(): ConflictException {
    return new ConflictException({
      code: 'SHIFT_ALREADY_OPEN',
      message: 'Cơ sở đang có ca mở. Đóng ca hiện tại trước khi mở ca mới.',
    });
  }

  private notOpen(): ConflictException {
    return new ConflictException({
      code: 'SHIFT_NOT_OPEN',
      message: 'Ca đã được đóng.',
    });
  }
}

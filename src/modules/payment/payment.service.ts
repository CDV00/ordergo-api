import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentRepository } from './repositories/payment.repository';
import { OrderRepository } from '../order/repositories/order.repository';
import { OrderEventRepository } from '../order/repositories/order-event.repository';
import { OrderService } from '../order/order.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CreatePaymentDto, ListPaymentsQuery, RefundPaymentDto } from './dto/payment.dto';
import { dayRange, DEFAULT_TIMEZONE } from '../../shared/utils/time';
import { VenueRepository } from '../tenant/repositories/venue.repository';
import { buildVietQrPayload } from '../../shared/utils/vietqr';
import { newId } from '../../shared/utils/uuid';
import { PaymentDoc } from './schemas/payment.schema';
import { ShiftRepository } from '../shift/repositories/shift.repository';
import { CustomerRepository } from '../customer/repositories/customer.repository';
import type { PaymentRequestMethod } from '../order/schemas/order.schema';

export interface PendingPaymentRequest {
  orderId: string;
  orderNumber: string;
  venueId: string;
  tableName: string | null;
  source: string;
  status: string;
  total: number;
  paidAmount: number;
  amountDue: number;
  method: PaymentRequestMethod;
  requestedAt: Date;
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly orders: OrderRepository,
    private readonly events: OrderEventRepository,
    private readonly loyalty: LoyaltyService,
    private readonly tenantCtx: TenantContextService,
    private readonly orderService: OrderService,
    private readonly venues: VenueRepository,
    private readonly shifts: ShiftRepository,
    private readonly customers: CustomerRepository,
  ) {}

  /** Danh sách payment theo khoảng ngày (mặc định hôm nay), mới nhất trước. */
  async list(q: ListPaymentsQuery): Promise<PaymentDoc[]> {
    const venue = q.venueId ? await this.venues.findById(q.venueId) : null;
    const timezone = venue?.timezone ?? DEFAULT_TIMEZONE;
    const filter: Record<string, unknown> = {};
    if (q.venueId) filter.venueId = q.venueId;
    if (q.method) filter.method = q.method;
    const from = dayRange(q.from, timezone).start;
    const to = dayRange(q.to ?? q.from, timezone).end;
    filter.receivedAt = { $gte: from, $lte: to };
    return this.payments.find(filter, { sort: { receivedAt: -1 }, limit: 500 });
  }

  /**
   * Đơn khách đã báo thanh toán (từ trang QR) nhưng nhân viên chưa xác nhận — mới nhất trước.
   * Nhân viên xác nhận bằng POST /orders/:id/payments như thu tiền bình thường.
   */
  async listPendingRequests(venueId?: string): Promise<PendingPaymentRequest[]> {
    const filter: Record<string, unknown> = {
      paymentRequest: { $ne: null },
      status: { $nin: ['paid', 'cancelled', 'refunded'] },
    };
    if (venueId) filter.venueId = venueId;
    const orders = await this.orders.find(filter, {
      sort: { 'paymentRequest.requestedAt': -1 },
      limit: 100,
    });
    if (orders.length === 0) return [];
    const payments = await this.payments.find({ orderId: { $in: orders.map((o) => o.id) } });
    const paidByOrder = new Map<string, number>();
    for (const p of payments) {
      if (p.status !== 'succeeded' && p.status !== 'partially_refunded') continue;
      const net = p.amount.amount - p.refundedAmount.amount;
      paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0) + net);
    }
    return orders.map((o) => {
      const paid = paidByOrder.get(o.id) ?? 0;
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        venueId: o.venueId,
        tableName: o.tableName,
        source: o.source,
        status: o.status,
        total: o.pricing.total.amount,
        paidAmount: paid,
        amountDue: Math.max(0, o.pricing.total.amount - paid),
        method: o.paymentRequest!.method,
        requestedAt: o.paymentRequest!.requestedAt,
      };
    });
  }

  async get(id: string): Promise<PaymentDoc> {
    return this.payments.findByIdOrFail(id);
  }

  /** Số tiền còn phải thu của đơn = total − (đã thu − đã hoàn). */
  async remainingDue(orderId: string): Promise<{ total: number; paid: number; remaining: number }> {
    const order = await this.orders.findByIdOrFail(orderId);
    const previous = await this.payments.findByOrder(orderId);
    const paid = previous
      .filter((p) => p.status === 'succeeded' || p.status === 'partially_refunded')
      .reduce((acc, p) => acc + (p.amount.amount - p.refundedAmount.amount), 0);
    const total = order.pricing.total.amount;
    return { total, paid, remaining: Math.max(total - paid, 0) };
  }

  /** VietQR động cho phần còn phải thu — thu ngân đưa khách quét ở quầy. */
  async paymentQr(orderId: string) {
    const order = await this.orders.findByIdOrFail(orderId);
    if (!['draft', 'sent', 'in_progress', 'ready', 'served'].includes(order.status)) {
      throw new BadRequestException({
        code: 'ORDER_NOT_PAYABLE',
        message: 'Đơn đã thanh toán hoặc đã huỷ.',
      });
    }
    const venue = await this.venues.findByIdOrFail(order.venueId);
    const bank = venue.settings?.bankAccount;
    if (!bank?.bankBin || !bank?.accountNumber) {
      throw new BadRequestException({
        code: 'NO_BANK_ACCOUNT',
        message: 'Chưa cấu hình tài khoản nhận tiền. Vào Cài đặt → Thanh toán để thêm.',
      });
    }
    const { remaining } = await this.remainingDue(orderId);
    const memo = `OG${order.orderNumber.replace(/-/g, '').slice(-12)}`;
    const accountName = bank.accountName ?? venue.name;
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: remaining,
      memo,
      qrPayload: buildVietQrPayload({
        bankBin: bank.bankBin,
        accountNumber: bank.accountNumber,
        accountName,
        amount: remaining,
        memo,
      }),
      bank: {
        bin: bank.bankBin,
        name: bank.bankName ?? '',
        accountNumber: bank.accountNumber,
        accountName,
      },
    };
  }

  async listForOrder(orderId: string): Promise<PaymentDoc[]> {
    return this.payments.findByOrder(orderId);
  }

  async createForOrder(
    orderId: string,
    dto: CreatePaymentDto,
  ): Promise<{
    payment: PaymentDoc;
    order: import('../order/schemas/order.schema').OrderDoc;
    paidTotal: number;
    totalDue: number;
  }> {
    const order = await this.orders.findByIdOrFail(orderId);
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATUS',
        message: 'Đơn không thể thu tiền ở trạng thái hiện tại.',
      });
    }
    const totalDue = order.pricing.total.amount;
    const previous = await this.payments.findByOrder(orderId);
    const paidBefore = previous
      .filter((p) => p.status === 'succeeded' || p.status === 'partially_refunded')
      .reduce((acc, p) => acc + (p.amount.amount - p.refundedAmount.amount), 0);
    if (dto.method === 'cash' && dto.tenderedAmount != null && dto.tenderedAmount < dto.amount) {
      throw new BadRequestException({
        code: 'TENDER_TOO_LOW',
        message: 'Tiền khách đưa ít hơn số tiền cần thu.',
      });
    }
    if (paidBefore + dto.amount > totalDue) {
      throw new BadRequestException({
        code: 'OVERPAY',
        message: `Số tiền vượt quá. Còn nợ: ${totalDue - paidBefore}đ`,
      });
    }

    // Luôn gắn vào ca đang mở của cơ sở (nếu có) — không nhận shiftId từ client để tránh gắn nhầm
    // vào ca khác/ca đã đóng làm lệch đối soát. Không chặn thu tiền khi quên mở ca.
    const shiftId = (await this.shifts.findOpen(order.venueId))?.id ?? null;

    const payment = await this.payments.create({
      venueId: order.venueId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      method: dto.method,
      amount: { amount: dto.amount, currency: 'VND' },
      tenderedAmount: dto.method === 'cash' ? (dto.tenderedAmount ?? dto.amount) : null,
      receivedAt: new Date(),
      receivedBy: this.tenantCtx.userId(),
      shiftId,
      externalRef: dto.externalRef ?? null,
      status: 'succeeded',
      failureReason: null,
      refundedAmount: { amount: 0, currency: 'VND' },
      refunds: [],
    } as Partial<PaymentDoc>);

    const paidNow = paidBefore + dto.amount;
    let updatedOrder = order;
    if (paidNow >= totalDue) {
      updatedOrder = await this.orders.updateById(orderId, {
        $set: { status: 'paid', paidAt: new Date(), paymentRequest: null },
      });
      await this.orderService.onOrderPaid(updatedOrder);
      await this.events.append({
        tenantId: order.tenantId,
        eventType: 'order.paid',
        aggregateId: order.id,
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          total: totalDue,
        },
      });

      // Thống kê khách cho đơn POS (đơn QR đã cộng lúc khách đặt — xem public-api)
      if (order.customerId && order.source !== 'qr_menu') {
        await this.customers.recordOrderInTenant(order.tenantId, order.customerId, totalDue);
      }

      // Loyalty earn — chỉ verified customer (anonymous bị skip trong service)
      if (order.customerId) {
        try {
          await this.loyalty.earnFromOrder({
            tenantId: order.tenantId,
            customerId: order.customerId,
            orderId: order.id,
            orderTotal: totalDue,
          });
        } catch (err) {
          // Không fail payment nếu loyalty fail — log + tiếp tục
          // (worker sẽ retry qua outbox sau này)

          console.error('[loyalty.earn] failed', err);
        }
      }
    }

    return { payment, order: updatedOrder, paidTotal: paidNow, totalDue };
  }

  async refund(paymentId: string, dto: RefundPaymentDto): Promise<PaymentDoc> {
    const payment = await this.payments.findByIdOrFail(paymentId);
    const remaining = payment.amount.amount - payment.refundedAmount.amount;
    if (dto.amount > remaining) {
      throw new BadRequestException({
        code: 'INVALID_REFUND_AMOUNT',
        message: `Số tiền hoàn vượt quá. Còn lại: ${remaining}đ`,
      });
    }
    const newRefunded = payment.refundedAmount.amount + dto.amount;
    const status: PaymentDoc['status'] =
      newRefunded >= payment.amount.amount ? 'refunded' : 'partially_refunded';
    return this.payments.updateById(paymentId, {
      $set: {
        refundedAmount: { amount: newRefunded, currency: 'VND' },
        status,
      },
      $push: {
        refunds: {
          id: newId(),
          amount: { amount: dto.amount, currency: 'VND' },
          reason: dto.reason ?? null,
          refundedAt: new Date(),
          refundedBy: this.tenantCtx.userId(),
        },
      },
    });
  }
}

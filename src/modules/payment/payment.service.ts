import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentRepository } from './repositories/payment.repository';
import { OrderRepository } from '../order/repositories/order.repository';
import { OrderEventRepository } from '../order/repositories/order-event.repository';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CreatePaymentDto, RefundPaymentDto } from './dto/payment.dto';
import { newId } from '../../shared/utils/uuid';
import { PaymentDoc } from './schemas/payment.schema';

@Injectable()
export class PaymentService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly orders: OrderRepository,
    private readonly events: OrderEventRepository,
    private readonly tenantCtx: TenantContextService,
  ) {}

  async listForOrder(orderId: string): Promise<PaymentDoc[]> {
    return this.payments.findByOrder(orderId);
  }

  async createForOrder(orderId: string, dto: CreatePaymentDto): Promise<{
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
      .reduce(
        (acc, p) => acc + (p.amount.amount - p.refundedAmount.amount),
        0,
      );
    if (paidBefore + dto.amount > totalDue) {
      throw new BadRequestException({
        code: 'OVERPAY',
        message: `Số tiền vượt quá. Còn nợ: ${totalDue - paidBefore}đ`,
      });
    }

    const payment = await this.payments.create({
      venueId: order.venueId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      method: dto.method,
      amount: { amount: dto.amount, currency: 'VND' },
      receivedAt: new Date(),
      receivedBy: this.tenantCtx.userId(),
      shiftId: dto.shiftId ?? null,
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
        $set: { status: 'paid', paidAt: new Date() },
      });
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

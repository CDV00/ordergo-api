import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CreatePaymentDto, ListPaymentsQuery, RefundPaymentDto } from './dto/payment.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  @Get('payments')
  @RequirePermissions('order.pay')
  listAll(@Query() q: ListPaymentsQuery) {
    return this.service.list(q);
  }

  /** Khai báo trước `payments/:id` để "pending" không bị hiểu là id. */
  @Get('payments/pending')
  @RequirePermissions('order.pay')
  pending(@Query('venueId') venueId?: string) {
    return this.service.listPendingRequests(venueId);
  }

  @Get('payments/:id')
  @RequirePermissions('order.pay')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Get('orders/:orderId/payment-qr')
  @RequirePermissions('order.pay')
  paymentQr(@Param('orderId') orderId: string) {
    return this.service.paymentQr(orderId);
  }

  @Get('orders/:orderId/payments')
  list(@Param('orderId') orderId: string) {
    return this.service.listForOrder(orderId);
  }

  @Post('orders/:orderId/payments')
  @RequirePermissions('order.pay')
  create(@Param('orderId') orderId: string, @Body() dto: CreatePaymentDto) {
    return this.service.createForOrder(orderId, dto);
  }

  @Post('payments/:id/refund')
  @RequirePermissions('order.refund')
  refund(@Param('id') id: string, @Body() dto: RefundPaymentDto) {
    return this.service.refund(id, dto);
  }
}

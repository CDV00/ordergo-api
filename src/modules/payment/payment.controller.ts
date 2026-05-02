import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CreatePaymentDto, RefundPaymentDto } from './dto/payment.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

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

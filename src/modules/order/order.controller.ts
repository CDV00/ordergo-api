import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrderService } from './order.service';
import {
  AddOrderLinesDto,
  ApplyDiscountDto,
  CancelOrderDto,
  CreateOrderDto,
  MoveTableDto,
  RemoveOrderLineDto,
  UpdateOrderLineDto,
} from './dto/order.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { IDEMPOTENCY_HEADER, Idempotent, isValidIdempotencyKey } from '../../common/idempotency';

class SetKitchenStatusDto {
  @IsEnum(['queued', 'preparing', 'ready', 'served', 'cancelled'])
  status!: 'queued' | 'preparing' | 'ready' | 'served' | 'cancelled';
}

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrderController {
  constructor(private readonly service: OrderService) {}

  @Get()
  list(
    @Query('venueId') venueId?: string,
    @Query('status') status?: string,
    @Query('tableId') tableId?: string,
  ) {
    return this.service.list({ venueId, status, tableId });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  /** POS offline gửi lại an toàn bằng header `Idempotency-Key`; key được lưu vào `clientId`. */
  @Post()
  @RequirePermissions('order.create')
  @Idempotent()
  create(@Body() dto: CreateOrderDto, @Headers(IDEMPOTENCY_HEADER) key?: string) {
    return this.service.createDraft(dto, key && isValidIdempotencyKey(key) ? key : null);
  }

  @Post(':id/lines')
  @RequirePermissions('order.update')
  @Idempotent()
  addLines(@Param('id') id: string, @Body() dto: AddOrderLinesDto) {
    return this.service.addLines(id, dto);
  }

  @Patch(':id/lines/:lineId')
  @RequirePermissions('order.update')
  updateLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateOrderLineDto,
  ) {
    return this.service.updateLine(id, lineId, dto);
  }

  /** Món đã gửi bếp: service kiểm thêm quyền `order.cancel`. */
  @Delete(':id/lines/:lineId')
  @RequirePermissions('order.update')
  removeLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: RemoveOrderLineDto,
  ) {
    return this.service.removeLine(id, lineId, dto);
  }

  @Post(':id/discount')
  @RequirePermissions('order.pay')
  applyDiscount(@Param('id') id: string, @Body() dto: ApplyDiscountDto) {
    return this.service.applyDiscount(id, dto);
  }

  @Post(':id/move-table')
  @RequirePermissions('order.update')
  moveTable(@Param('id') id: string, @Body() dto: MoveTableDto) {
    return this.service.moveTable(id, dto.tableId);
  }

  @Post(':id/send-to-kitchen')
  @RequirePermissions('order.send_to_kitchen')
  @Idempotent()
  send(@Param('id') id: string) {
    return this.service.sendToKitchen(id);
  }

  @Post(':id/cancel')
  @RequirePermissions('order.cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.service.cancel(id, dto);
  }

  @Patch(':id/lines/:lineId/kitchen-status')
  @RequirePermissions('order.update_kitchen_status')
  setLineStatus(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: SetKitchenStatusDto,
  ) {
    return this.service.setLineKitchenStatus(id, lineId, dto.status);
  }
}

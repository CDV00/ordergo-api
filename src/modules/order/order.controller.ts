import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrderService } from './order.service';
import { CancelOrderDto, CreateOrderDto } from './dto/order.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

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
  list(@Query('venueId') venueId?: string, @Query('status') status?: string) {
    return this.service.list({ venueId, status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('order.create')
  create(@Body() dto: CreateOrderDto) {
    return this.service.createDraft(dto);
  }

  @Post(':id/send-to-kitchen')
  @RequirePermissions('order.send_to_kitchen')
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

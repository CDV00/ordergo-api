import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ShiftService } from './shift.service';
import { CloseShiftDto, CurrentShiftQuery, ListShiftsQuery, OpenShiftDto } from './dto/shift.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Shifts')
@ApiBearerAuth()
@Controller('shifts')
export class ShiftController {
  constructor(private readonly service: ShiftService) {}

  /** Ca đang mở (kèm số liệu tạm tính) hoặc null. Cần shift.open hoặc shift.close (kiểm trong service). */
  @Get('current')
  current(@Query() q: CurrentShiftQuery) {
    return this.service.current(q.venueId);
  }

  @Post('open')
  @RequirePermissions('shift.open')
  open(@Body() dto: OpenShiftDto) {
    return this.service.open(dto);
  }

  @Post(':id/close')
  @RequirePermissions('shift.close')
  close(@Param('id') id: string, @Body() dto: CloseShiftDto) {
    return this.service.close(id, dto);
  }

  @Get()
  @RequirePermissions('shift.close')
  list(@Query() q: ListShiftsQuery) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions('shift.close')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }
}

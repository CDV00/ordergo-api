import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReportingService } from './reporting.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportingController {
  constructor(private readonly service: ReportingService) {}

  @Get('today')
  @RequirePermissions('report.view')
  today(@Query('venueId') venueId?: string) {
    return this.service.dailySummary(venueId);
  }

  /** `date` = YYYY-MM-DD theo giờ của cơ sở. */
  @Get('daily')
  @RequirePermissions('report.view')
  daily(@Query('venueId') venueId?: string, @Query('date') date?: string) {
    return this.service.dailySummary(venueId, date);
  }
}

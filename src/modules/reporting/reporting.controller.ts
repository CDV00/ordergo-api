import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportingService } from './reporting.service';
import { SalesReportService } from './sales-report.service';
import { SalesExportQuery, SalesReportQuery } from './dto/sales-report.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportingController {
  constructor(
    private readonly service: ReportingService,
    private readonly sales: SalesReportService,
  ) {}

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

  /** Báo cáo bán hàng `from`..`to` (YYYY-MM-DD, tính cả 2 đầu, giờ cơ sở; tối đa 92 ngày). */
  @Get('sales')
  @RequirePermissions('report.view')
  salesReport(@Query() q: SalesReportQuery) {
    return this.sales.salesReport(q.venueId, q.from, q.to);
  }

  /**
   * Xuất CSV (UTF-8 BOM). Dùng `@Res()` để gửi file thô — không qua TransformInterceptor
   * (interceptor sẽ bọc mọi object không có `data` thành `{ data }`, kể cả StreamableFile).
   */
  @Get('sales/export')
  @RequirePermissions('report.export')
  @ApiProduces('text/csv')
  async salesExport(@Query() q: SalesExportQuery, @Res() res: Response): Promise<void> {
    const { filename, content } = await this.sales.exportCsv(q.venueId, q.from, q.to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(Buffer.from(content, 'utf8'));
  }
}

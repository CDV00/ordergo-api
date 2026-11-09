import { IsIn, IsOptional, IsString } from 'class-validator';

/** Ngày dạng YYYY-MM-DD theo giờ cơ sở; kiểm tra chi tiết (định dạng, khoảng) ở `resolveRange`. */
export class SalesReportQuery {
  @IsOptional() @IsString() venueId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class SalesExportQuery extends SalesReportQuery {
  @IsOptional() @IsIn(['csv']) format?: 'csv';
}

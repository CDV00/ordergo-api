import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class OpenShiftDto {
  @IsString()
  venueId!: string;

  /** Tiền mặt đầu ca (VND, số nguyên ≥ 0). */
  @IsInt()
  @Min(0)
  openingCash!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CloseShiftDto {
  /** Tiền mặt đếm thực tế trong két (VND, số nguyên ≥ 0). */
  @IsInt()
  @Min(0)
  countedCash!: number;

  /** Bắt buộc khi tiền đếm lệch với tiền dự kiến. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CurrentShiftQuery {
  @IsOptional() @IsString() venueId?: string;
}

export class ListShiftsQuery {
  @IsOptional() @IsString() venueId?: string;
  /** YYYY-MM-DD theo giờ của cơ sở (mặc định 6 ngày trước `to`). */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  /** YYYY-MM-DD theo giờ của cơ sở (mặc định hôm nay). */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

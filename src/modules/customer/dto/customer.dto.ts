import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export const CUSTOMER_STATUSES = ['anonymous', 'verified', 'full'] as const;

export class ListCustomersQuery {
  /** Ô tìm kiếm: SĐT (khớp chính xác) hoặc một phần tên. KHÔNG log giá trị này. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(CUSTOMER_STATUSES)
  status?: (typeof CUSTOMER_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/**
 * Sửa hồ sơ khách. Trường không gửi (undefined) = giữ nguyên; `null` = xoá giá trị.
 * Không cho sửa SĐT (gắn với tài khoản khách, đổi qua luồng OTP).
 */
export class UpdateCustomerDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254)
  email?: string | null;

  /** YYYY-MM-DD */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày sinh phải có dạng YYYY-MM-DD.' })
  @IsDateString({ strict: true }, { message: 'Ngày sinh không hợp lệ (YYYY-MM-DD).' })
  birthday?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? (value as unknown[]).map((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v))
      : value,
  )
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(30, { each: true })
  tags?: string[] | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

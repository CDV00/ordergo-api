import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { BusinessType } from '../schemas/venue.schema';

export class CreateVenueDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MinLength(1) @MaxLength(20) code!: string;
  @IsEnum([
    'restaurant',
    'cafe',
    'bar',
    'hotel',
    'homestay',
    'spa',
    'gym',
    'education',
    'coworking',
  ])
  businessType!: BusinessType;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() phone?: string;
}

export class BankAccountDto {
  /** BIN ngân hàng 6 số (vd 970436 = Vietcombank) */
  @Matches(/^\d{6}$/, { message: 'Mã BIN ngân hàng gồm 6 chữ số' })
  bankBin!: string;
  @IsOptional() @IsString() @MaxLength(50) bankName?: string;
  @Matches(/^[0-9A-Za-z]{4,19}$/, { message: 'Số tài khoản không hợp lệ' })
  accountNumber!: string;
  @IsString() @MinLength(2) @MaxLength(50) accountName!: string;
}

export class UpdateVenueDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(255) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  /** 0–0.2 (0–20%) */
  @IsOptional() @IsNumber() @Min(0) @Max(0.2) serviceChargeRate?: number;
  @IsOptional() @IsIn([0, 0.05, 0.08, 0.1]) vatRate?: number;
  @IsOptional() @IsString() @MaxLength(200) receiptFooter?: string;
  /** null = xoá tài khoản nhận tiền */
  @IsOptional()
  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount?: BankAccountDto | null;
}

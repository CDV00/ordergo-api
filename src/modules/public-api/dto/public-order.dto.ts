import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class PublicOrderLineInput {
  @IsString() menuItemId!: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) toppingOptionIds?: string[];
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsString() note?: string;
}

export class PublicPaymentRequestDto {
  /** vietqr = khách báo đã chuyển khoản; cash / card = khách muốn trả tại quầy */
  @IsIn(['vietqr', 'cash', 'card'])
  method!: 'vietqr' | 'cash' | 'card';
}

export class PublicCreateOrderDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PublicOrderLineInput)
  lines!: PublicOrderLineInput[];

  /** Khách tự nhập tên (optional, soft-validation) */
  @IsOptional()
  @IsString()
  guestName?: string;
}

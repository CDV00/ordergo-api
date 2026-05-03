import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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

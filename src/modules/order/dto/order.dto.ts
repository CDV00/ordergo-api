import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderLineInput {
  @IsString() menuItemId!: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) toppingOptionIds?: string[];
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsString() note?: string;
}

export class CreateOrderDto {
  @IsString() venueId!: string;

  @IsEnum(['dine_in', 'takeaway', 'delivery', 'online', 'room_service'])
  orderType!: 'dine_in' | 'takeaway' | 'delivery' | 'online' | 'room_service';

  @IsOptional() @IsString() tableId?: string;
  @IsOptional() @IsString() customerId?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInput)
  lines!: OrderLineInput[];
}

export class AddOrderLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInput)
  lines!: OrderLineInput[];
}

export class CancelOrderDto {
  @IsOptional() @IsString() reason?: string;
}

export class UpdateOrderLineDto {
  @IsOptional() @IsInt() @Min(1) @Max(99) quantity?: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class RemoveOrderLineDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class ApplyDiscountDto {
  @IsEnum(['percent', 'amount']) type!: 'percent' | 'amount';
  /** percent: 0–100; amount: VND. 0 = bỏ giảm giá. */
  @IsInt() @Min(0) value!: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class MoveTableDto {
  @IsString() tableId!: string;
}

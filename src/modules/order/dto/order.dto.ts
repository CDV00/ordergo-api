import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class OrderLineInput {
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

export class AddOrderLineDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInput)
  lines!: OrderLineInput[];
}

export class CancelOrderDto {
  @IsOptional() @IsString() reason?: string;
}

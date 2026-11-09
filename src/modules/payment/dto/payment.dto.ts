import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePaymentDto {
  @IsEnum(['cash', 'vietqr', 'momo', 'vnpay', 'zalopay', 'card', 'bank_transfer'])
  method!: 'cash' | 'vietqr' | 'momo' | 'vnpay' | 'zalopay' | 'card' | 'bank_transfer';

  @IsInt()
  @Min(0)
  amount!: number;

  /** Tiền mặt khách đưa — phải ≥ amount. */
  @IsOptional()
  @IsInt()
  @Min(0)
  tenderedAmount?: number;

  @IsOptional()
  @IsString()
  externalRef?: string;
}

export class RefundPaymentDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ListPaymentsQuery {
  @IsOptional() @IsString() venueId?: string;
  /** YYYY-MM-DD theo giờ của cơ sở */
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional()
  @IsEnum(['cash', 'vietqr', 'momo', 'vnpay', 'zalopay', 'card', 'bank_transfer'])
  method?: string;
}

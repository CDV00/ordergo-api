import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePaymentDto {
  @IsEnum(['cash', 'vietqr', 'momo', 'vnpay', 'zalopay', 'card', 'bank_transfer'])
  method!: 'cash' | 'vietqr' | 'momo' | 'vnpay' | 'zalopay' | 'card' | 'bank_transfer';

  @IsInt()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  externalRef?: string;

  @IsOptional()
  @IsString()
  shiftId?: string;
}

export class RefundPaymentDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

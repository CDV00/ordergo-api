import { IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^\+?[0-9]{9,15}$/, { message: 'Số điện thoại không hợp lệ' })
  phone!: string;
}

export class VerifyOtpClaimDto {
  @IsString()
  @Matches(/^\+?[0-9]{9,15}$/, { message: 'Số điện thoại không hợp lệ' })
  phone!: string;

  @IsString()
  @Length(6, 6, { message: 'Mã OTP gồm 6 chữ số' })
  code!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;
}

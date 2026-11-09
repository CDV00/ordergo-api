import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  phone!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'Mật khẩu mới tối thiểu 8 ký tự' })
  newPassword!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

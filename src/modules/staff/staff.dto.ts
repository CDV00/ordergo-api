import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ASSIGNABLE_ROLES, type AssignableRole } from './staff.rules';

export class InviteStaffDto {
  @IsString()
  @Matches(/^\+?[0-9]{9,15}$/, { message: 'Số điện thoại không hợp lệ' })
  phone!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @IsIn(ASSIGNABLE_ROLES as unknown as string[], { message: 'Vai trò không hợp lệ' })
  roleCode!: AssignableRole;

  /** Cơ sở làm việc. venue_manager/thu ngân/phục vụ/bếp luôn gắn 1 cơ sở. */
  @IsString()
  venueId!: string;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES as unknown as string[], { message: 'Vai trò không hợp lệ' })
  roleCode?: AssignableRole;

  @IsOptional()
  @IsString()
  venueId?: string;
}

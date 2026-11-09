import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CopyMenuDto {
  /** Cơ sở nguồn (cùng tenant). */
  @IsString() @MinLength(1) fromVenueId!: string;
  /** true = xoá mềm menu hiện có của cơ sở đích trước khi chép. */
  @IsOptional() @IsBoolean() replace?: boolean;
}

import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTableDto {
  @IsString() venueId!: string;
  @IsOptional() @IsString() @MaxLength(50) section?: string;
  @IsString() @MinLength(1) @MaxLength(50) name!: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

export class UpdateTableDto {
  @IsOptional() @IsString() @MaxLength(50) section?: string;
  @IsOptional() @IsString() @MaxLength(50) name?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

export class ChangeTableStatusDto {
  @IsEnum(['available', 'occupied', 'reserved', 'cleaning', 'out_of_order'])
  status!: 'available' | 'occupied' | 'reserved' | 'cleaning' | 'out_of_order';
}

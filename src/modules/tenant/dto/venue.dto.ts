import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { BusinessType } from '../schemas/venue.schema';

export class CreateVenueDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MinLength(1) @MaxLength(20) code!: string;
  @IsEnum([
    'restaurant',
    'cafe',
    'bar',
    'hotel',
    'homestay',
    'spa',
    'gym',
    'education',
    'coworking',
  ])
  businessType!: BusinessType;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() phone?: string;
}

export class UpdateVenueDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() phone?: string;
}

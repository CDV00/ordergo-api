import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { BusinessType } from '../schemas/venue.schema';

export class SetupWizardDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  tenantName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxCode?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  venueName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  venueCode!: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;
}

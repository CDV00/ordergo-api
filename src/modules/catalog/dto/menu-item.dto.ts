import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

class MoneyDto {
  @IsInt() @Min(0) amount!: number;
  @IsOptional() @IsString() currency?: string;
}

class VariantDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MinLength(1) @MaxLength(50) name!: string;
  @ValidateNested() @Type(() => MoneyDto) priceModifier!: MoneyDto;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class ToppingOptionDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MinLength(1) @MaxLength(50) name!: string;
  @ValidateNested() @Type(() => MoneyDto) priceModifier!: MoneyDto;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
}

class ToppingGroupDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MinLength(1) @MaxLength(50) name!: string;
  @IsOptional() @IsInt() @Min(0) minSelect?: number;
  @IsOptional() @IsInt() @Min(1) maxSelect?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ToppingOptionDto)
  options!: ToppingOptionDto[];
}

export class CreateMenuItemDto {
  @IsOptional() @IsString() venueId?: string;
  @IsString() categoryId!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(50) sku?: string;
  @ValidateNested() @Type(() => MoneyDto) basePrice!: MoneyDto;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => VariantDto)
  variants?: VariantDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => ToppingGroupDto)
  toppingGroups?: ToppingGroupDto[];

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];
}

export class UpdateMenuItemDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(50) sku?: string;
  @IsOptional() @ValidateNested() @Type(() => MoneyDto) basePrice?: MoneyDto;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => VariantDto)
  variants?: VariantDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => ToppingGroupDto)
  toppingGroups?: ToppingGroupDto[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsBoolean() isAvailable?: boolean;
}

export class ToggleAvailabilityDto {
  @IsBoolean() isAvailable!: boolean;
  @IsOptional() @IsString() unavailableReason?: string;
}

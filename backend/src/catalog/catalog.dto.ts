import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Outlet, PrepStation } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { HotelQueryDto } from '../common/hotel-query.dto';

export class CreateCategoryDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsEnum(Outlet)
  outlet?: Outlet | null;

  @IsOptional()
  @IsEnum(PrepStation)
  prepStation?: PrepStation;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCategoryDto extends PartialType(OmitType(CreateCategoryDto, ['hotelId'] as const)) {}

export class CreateProductDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsOptional()
  @IsInt()
  categoryId?: number | null;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sku?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsInt()
  taxRateId?: number | null;

  @IsOptional()
  @IsBoolean()
  sellable?: boolean;

  @IsOptional()
  @IsBoolean()
  trackStock?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minStock?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['hotelId'] as const)) {}

export class ProductQueryDto extends HotelQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsEnum(Outlet)
  outlet?: Outlet;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  sellable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

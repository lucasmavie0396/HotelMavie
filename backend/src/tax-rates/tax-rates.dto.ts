import { OmitType, PartialType } from '@nestjs/mapped-types';
import { TaxCategory } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateTaxRateDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @MaxLength(60)
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate: number;

  @IsOptional()
  @IsEnum(TaxCategory)
  atCategory?: TaxCategory;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  exemptionReason?: string;

  @IsOptional()
  @Matches(/^M\d{2}$/, { message: 'O codigo de isencao segue o formato da AT (ex.: M07)' })
  exemptionCode?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateTaxRateDto extends PartialType(OmitType(CreateTaxRateDto, ['hotelId', 'rate'] as const)) {}

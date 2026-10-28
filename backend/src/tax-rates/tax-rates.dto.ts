import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
  @IsString()
  @MaxLength(255)
  exemptionReason?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateTaxRateDto extends PartialType(OmitType(CreateTaxRateDto, ['hotelId'] as const)) {}

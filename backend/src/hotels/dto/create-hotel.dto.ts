import { Transform } from 'class-transformer';
import { normalizeDomain } from '../domains';
import { IsBoolean, IsEmail, IsInt, IsISO4217CurrencyCode, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateHotelDto {
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'publicSlug so pode ter minusculas, numeros e hifens' })
  @MaxLength(100)
  publicSlug?: string;

  @IsOptional()
  @IsBoolean()
  publicEnabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => normalizeDomain(value))
  @IsString()
  @MaxLength(253)
  @Matches(/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/, {
    message: 'Dominio invalido: escreve so o endereco, por exemplo www.hotelmavie.co.mz',
  })
  customDomain?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsISO4217CurrencyCode()
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  taxId?: string;

  @IsOptional()
  @IsString()
  invoiceFooter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ticketFooter?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  publicDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  publicDescriptionEn?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  depositPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  paymentInstructions?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  paymentInstructionsEn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'Pais em codigo ISO de 2 letras (ex.: PT)' })
  country?: string;

  @IsOptional()
  @IsInt()
  accommodationTaxRateId?: number | null;
}

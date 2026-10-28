import { ChargeType, InvoiceType, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, MaxLength, Min, NotEquals } from 'class-validator';

export class CreateChargeDto {
  @IsString()
  @MaxLength(200)
  description: string;

  @IsOptional()
  @IsEnum(ChargeType)
  type?: ChargeType;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  unitPrice: number;

  @IsOptional()
  @IsInt()
  taxRateId?: number;
}

export class CreatePaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @NotEquals(0)
  amount: number;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional()
  @IsInt()
  cashSessionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class IssueInvoiceDto {
  @IsOptional()
  @IsIn([InvoiceType.INVOICE, InvoiceType.INVOICE_RECEIPT])
  type?: InvoiceType;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  chargeIds?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customerTaxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerAddress?: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;
}

export class CreditNoteDto {
  @IsString()
  @Length(3, 255)
  reason: string;
}

export class InvoiceQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;

  @IsOptional()
  @IsEnum(InvoiceType)
  type?: InvoiceType;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

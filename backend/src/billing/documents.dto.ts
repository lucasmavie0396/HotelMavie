import { InvoiceStatus, QuoteStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { HotelQueryDto } from '../common/hotel-query.dto';

export class DocumentLineDto {
  @IsOptional()
  @IsInt()
  productId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsInt()
  taxRateId?: number;
}

export class DocumentCustomerDto {
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
  @MaxLength(150)
  customerEmail?: string;
}

export class CreateManualInvoiceDto extends DocumentCustomerDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DocumentLineDto)
  lines: DocumentLineDto[];
}

export class CreateQuoteDto extends DocumentCustomerDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsDateString({ strict: true })
  @Length(10, 10)
  validUntil: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DocumentLineDto)
  lines: DocumentLineDto[];
}

export class ConvertQuoteDto extends DocumentCustomerDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  dueDate?: string;
}

export class CancelQuoteDto {
  @IsString()
  @Length(3, 255)
  reason: string;
}

export class QuoteQueryDto extends HotelQueryDto {
  @IsOptional()
  @IsEnum(QuoteStatus)
  status?: QuoteStatus;

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

export class ReceiptQueryDto extends HotelQueryDto {
  @IsOptional()
  @IsEnum(['ISSUED', 'CANCELLED'])
  status?: 'ISSUED' | 'CANCELLED';

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

export class CreditLineDto {
  @IsInt()
  lineId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;
}

export class CreditNoteLinesDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique((line: CreditLineDto) => line.lineId)
  @ValidateNested({ each: true })
  @Type(() => CreditLineDto)
  lines?: CreditLineDto[];
}

export const booleanQuery = ({ value }: { value: unknown }) => value === 'true' || value === true;

export class InvoiceFiltersDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @Transform(booleanQuery)
  @IsBoolean()
  unpaid?: boolean;
}

import { BookingKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CompanionDto } from '../../reservations/dto/companion.dto';
import { CompanyDto, MAX_GROUP_ROOMS, OccupantDto } from '../../reservations/dto/group-booking.dto';

export class PublicRoomRequestDto {
  @IsString()
  @MaxLength(60)
  roomType: string;

  @IsInt()
  @Min(1)
  @Max(20)
  adults: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  children?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => OccupantDto)
  occupant?: OccupantDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(19)
  @ValidateNested({ each: true })
  @Type(() => CompanionDto)
  companions?: CompanionDto[];
}

export class PublicAvailabilityQueryDto {
  @IsDateString({ strict: true })
  @Length(10, 10)
  checkIn: string;

  @IsDateString({ strict: true })
  @Length(10, 10)
  checkOut: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  guests?: number;
}

export class PublicBookingDto {
  @IsDateString({ strict: true })
  @Length(10, 10)
  checkIn: string;

  @IsDateString({ strict: true })
  @Length(10, 10)
  checkOut: string;

  @IsOptional()
  @IsEnum(BookingKind)
  kind?: BookingKind;

  @ValidateIf((dto: PublicBookingDto) => dto.kind === BookingKind.CORPORATE)
  @IsDefined()
  @ValidateNested()
  @Type(() => CompanyDto)
  company?: CompanyDto;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_GROUP_ROOMS)
  @ValidateNested({ each: true })
  @Type(() => PublicRoomRequestDto)
  rooms?: PublicRoomRequestDto[];

  @ValidateIf((dto: PublicBookingDto) => !dto.rooms)
  @IsString()
  @MaxLength(60)
  roomType?: string;

  @ValidateIf((dto: PublicBookingDto) => !dto.rooms)
  @IsInt()
  @Min(1)
  @Max(20)
  adults?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  children?: number;

  @IsString()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MaxLength(100)
  lastName: string;

  @IsEmail()
  @MaxLength(150)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  nationality?: string;

  @ValidateIf((dto: PublicBookingDto) => dto.kind !== BookingKind.CORPORATE)
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  documentType?: string;

  @ValidateIf((dto: PublicBookingDto) => dto.kind !== BookingKind.CORPORATE)
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  documentNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(19)
  @ValidateNested({ each: true })
  @Type(() => CompanionDto)
  companions?: CompanionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  depositReference?: string;

  @IsOptional()
  @IsInt()
  depositPaymentTypeId?: number;

  @IsOptional()
  @IsIn(['pt', 'en'])
  locale?: 'pt' | 'en';
}

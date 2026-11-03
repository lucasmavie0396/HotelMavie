import { BookingKind, ReservationSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
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
import { CompanionDto } from './companion.dto';

export const MAX_GROUP_ROOMS = 30;

export class CompanyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @IsString()
  @MinLength(5)
  @MaxLength(30)
  taxId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

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
  @MaxLength(150)
  contactName?: string;
}

export class OccupantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  nationality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  documentType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentNumber?: string;
}

export class GroupRoomDto {
  @IsInt()
  roomId: number;

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
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pricePerNight?: number;

  @IsOptional()
  @IsInt()
  guestId?: number;

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

export class CreateGroupReservationDto {
  @IsEnum(BookingKind)
  kind: BookingKind;

  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsOptional()
  @IsInt()
  guestId?: number;

  @ValidateIf((dto: CreateGroupReservationDto) => dto.kind === BookingKind.CORPORATE || dto.company !== undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => CompanyDto)
  company?: CompanyDto;

  @IsDateString({ strict: true })
  @Length(10, 10)
  checkIn: string;

  @IsDateString({ strict: true })
  @Length(10, 10)
  checkOut: string;

  @IsOptional()
  @IsEnum(ReservationSource)
  source?: ReservationSource;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_GROUP_ROOMS)
  @ValidateNested({ each: true })
  @Type(() => GroupRoomDto)
  rooms: GroupRoomDto[];
}

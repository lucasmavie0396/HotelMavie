import { OmitType, PartialType } from '@nestjs/mapped-types';
import { ContractType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { HotelQueryDto } from '../common/hotel-query.dto';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class EmployeeDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsOptional()
  @IsInt()
  userId?: number | null;

  @IsString()
  @MaxLength(150)
  fullName: string;

  @IsString()
  @MaxLength(80)
  jobTitle: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  department?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  socialSecurityNumber?: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}$/, { message: 'IBAN invalido' })
  iban?: string;

  @IsOptional()
  @IsEnum(ContractType)
  contractType?: ContractType;

  @IsDateString({ strict: true })
  @Length(10, 10)
  startDate: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  endDate?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(80)
  weeklyHours?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseSalary?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateEmployeeDto extends PartialType(OmitType(EmployeeDto, ['hotelId'] as const)) {}

export class ShiftDto {
  @IsInt()
  employeeId: number;

  @IsDateString({ strict: true })
  @Length(10, 10)
  date: string;

  @Matches(TIME, { message: 'Hora no formato HH:mm' })
  startTime: string;

  @Matches(TIME, { message: 'Hora no formato HH:mm' })
  endTime: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  breakMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}

export class UpdateShiftDto extends PartialType(OmitType(ShiftDto, ['employeeId'] as const)) {}

export class RangeQueryDto extends HotelQueryDto {
  @IsDateString({ strict: true })
  @Length(10, 10)
  from: string;

  @IsDateString({ strict: true })
  @Length(10, 10)
  to: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  employeeId?: number;
}

export class CopyWeekDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsDateString({ strict: true })
  @Length(10, 10)
  fromWeek: string;

  @IsDateString({ strict: true })
  @Length(10, 10)
  toWeek: string;
}

export class ClockDto {
  @IsOptional()
  @IsInt()
  employeeId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}

export class UpdateTimeEntryDto {
  @IsOptional()
  @IsISO8601()
  clockIn?: string;

  @IsOptional()
  @IsISO8601()
  clockOut?: string | null;

  @IsString()
  @Length(3, 200)
  notes: string;
}

export class MonthQueryDto extends HotelQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mes no formato AAAA-MM' })
  month: string;
}

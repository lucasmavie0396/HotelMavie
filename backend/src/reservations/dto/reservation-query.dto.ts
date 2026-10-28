import { ReservationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class ReservationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;

  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  guestId?: number;

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

export class AvailabilityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;

  @IsDateString({ strict: true })
  @Length(10, 10)
  checkIn: string;

  @IsDateString({ strict: true })
  @Length(10, 10)
  checkOut: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  guests?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  excludeReservationId?: number;
}

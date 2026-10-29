import { Type } from 'class-transformer';
import { IsDateString, IsEmail, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

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
  @IsString()
  @MaxLength(100)
  depositReference?: string;

  @IsOptional()
  @IsInt()
  depositPaymentTypeId?: number;
}

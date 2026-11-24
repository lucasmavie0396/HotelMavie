import { RoomStatus } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

export class CreateRoomDto {
  @IsInt()
  hotelId: number;

  @IsString()
  @MaxLength(20)
  number: string;

  @IsString()
  @MaxLength(60)
  type: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pricePerNight: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  taxRateId?: number | null;

  @IsOptional()
  @IsEnum(RoomStatus)
  status?: RoomStatus;

  @IsOptional()
  @IsInt()
  floor?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  descriptionEn?: string;
}

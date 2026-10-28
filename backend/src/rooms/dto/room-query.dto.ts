import { RoomStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional } from 'class-validator';

export class RoomQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;

  @IsOptional()
  @IsEnum(RoomStatus)
  status?: RoomStatus;
}

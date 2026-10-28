import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class HotelQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;
}

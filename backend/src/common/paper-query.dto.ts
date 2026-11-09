import { PaperWidth } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class PaperQueryDto {
  @IsOptional()
  @IsEnum(PaperWidth)
  paper?: PaperWidth;
}

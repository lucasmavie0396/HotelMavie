import { IsBoolean, IsDateString, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class CompanionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @IsOptional()
  @IsBoolean()
  isChild?: boolean;

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

export function companionData(dto: CompanionDto) {
  const text = (value?: string) => value?.trim() || null;
  return {
    firstName: dto.firstName.trim(),
    lastName: dto.lastName.trim(),
    isChild: dto.isChild ?? false,
    birthDate: dto.birthDate ? new Date(`${dto.birthDate}T00:00:00.000Z`) : null,
    nationality: text(dto.nationality),
    documentType: text(dto.documentType),
    documentNumber: text(dto.documentNumber),
  };
}

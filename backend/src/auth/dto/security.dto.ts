import { IsEmail, IsInt, IsOptional, IsString, Length, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class TwoFactorLoginDto {
  @IsString()
  @MaxLength(2000)
  challenge: string;

  @IsString()
  @Length(6, 12)
  code: string;
}

export class TwoFactorCodeDto {
  @IsString()
  @Length(6, 12)
  code: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @Length(6, 12)
  code: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(150)
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(20, 200)
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;
}

export class PinLoginDto {
  @IsInt()
  userId: number;

  @IsString()
  @Matches(/^\d{4,6}$/)
  pin: string;
}

export class SetPinDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'O codigo tem de ter 4 a 6 algarismos' })
  pin: string | null;
}

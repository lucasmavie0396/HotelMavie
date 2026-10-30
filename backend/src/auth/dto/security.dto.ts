import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';

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

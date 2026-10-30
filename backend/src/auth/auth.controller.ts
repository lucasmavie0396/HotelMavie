import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { DisableTwoFactorDto, ForgotPasswordDto, ResetPasswordDto, TwoFactorCodeDto, TwoFactorLoginDto } from './dto/security.dto';
import { JwtPayload } from './jwt-payload';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.login(dto, userAgent);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/2fa')
  @HttpCode(HttpStatus.OK)
  loginTwoFactor(@Body() dto: TwoFactorLoginDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.loginTwoFactor(dto.challenge, dto.code, userAgent);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Get('2fa')
  twoFactorStatus(@CurrentUser() user: JwtPayload) {
    return this.authService.twoFactorStatus(user.sub);
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  setupTwoFactor(@CurrentUser() user: JwtPayload) {
    return this.authService.setupTwoFactor(user.sub);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  enableTwoFactor(@CurrentUser() user: JwtPayload, @Body() dto: TwoFactorCodeDto) {
    return this.authService.enableTwoFactor(user.sub, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  disableTwoFactor(@CurrentUser() user: JwtPayload, @Body() dto: DisableTwoFactorDto) {
    return this.authService.disableTwoFactor(user.sub, dto.password, dto.code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.refresh(dto.refreshToken, userAgent);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser() user: JwtPayload, @Body() dto: Partial<RefreshDto>) {
    return this.authService.logout(user.sub, typeof dto?.refreshToken === 'string' ? dto.refreshToken : undefined);
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user.sub);
  }
}

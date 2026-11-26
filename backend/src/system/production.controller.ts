import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { CleanupDto, ProductionService, StartProductionDto } from './production.service';

@Roles(UserRole.ADMIN)
@Controller('system')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get('production')
  status(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.production.status(query.hotelId, user);
  }

  @Post('production')
  @HttpCode(HttpStatus.OK)
  start(@Body() dto: StartProductionDto, @CurrentUser() user: JwtPayload) {
    return this.production.start(dto, user);
  }

  @Get('cleanup')
  cleanupStatus(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.production.cleanupStatus(query.hotelId, user);
  }

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  cleanup(@Body() dto: CleanupDto, @CurrentUser() user: JwtPayload) {
    return this.production.cleanup(dto, user);
  }
}

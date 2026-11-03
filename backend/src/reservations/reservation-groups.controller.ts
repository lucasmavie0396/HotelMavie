import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateGroupReservationDto } from './dto/group-booking.dto';
import { ReservationsService } from './reservations.service';

class CompanyQueryDto {
  @IsString()
  @MinLength(5)
  @MaxLength(30)
  taxId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;
}

@Controller('reservation-groups')
export class ReservationGroupsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  create(@Body() dto: CreateGroupReservationDto, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.createGroup(dto, user);
  }

  @Get('company')
  async company(@Query() query: CompanyQueryDto, @CurrentUser() user: JwtPayload) {
    return (await this.reservationsService.lastCompany(query.taxId, user, query.hotelId)) ?? {};
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.findGroup(id, user);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.confirmGroup(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.cancelGroup(id, user);
  }
}

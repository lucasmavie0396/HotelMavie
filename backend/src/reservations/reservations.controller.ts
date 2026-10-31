import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ReservationStatus, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SalesAccess } from '../common/decorators/roles.decorator';
import { ConfirmDepositDto, DepositService } from './deposit.service';
import { CompanionDto } from './dto/companion.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { AvailabilityQueryDto, ReservationQueryDto } from './dto/reservation-query.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly deposits: DepositService,
  ) {}

  @SalesAccess()
  @Get()
  findAll(@Query() query: ReservationQueryDto, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.findAll(user.role === UserRole.CASHIER ? { ...query, status: ReservationStatus.CHECKED_IN } : query, user);
  }

  @Get('availability')
  availability(@Query() query: AvailabilityQueryDto, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.availability(query, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateReservationDto, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReservationDto, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.update(id, dto, user);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.confirm(id, user);
  }

  @Post(':id/companions')
  addCompanion(@Param('id', ParseIntPipe) id: number, @Body() dto: CompanionDto, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.addCompanion(id, dto, user);
  }

  @Patch(':id/companions/:companionId')
  updateCompanion(
    @Param('id', ParseIntPipe) id: number,
    @Param('companionId', ParseIntPipe) companionId: number,
    @Body() dto: CompanionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reservationsService.updateCompanion(id, companionId, dto, user);
  }

  @Delete(':id/companions/:companionId')
  removeCompanion(@Param('id', ParseIntPipe) id: number, @Param('companionId', ParseIntPipe) companionId: number, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.removeCompanion(id, companionId, user);
  }

  @Post(':id/deposit/confirm')
  @HttpCode(HttpStatus.OK)
  confirmDeposit(@Param('id', ParseIntPipe) id: number, @Body() dto: ConfirmDepositDto, @CurrentUser() user: JwtPayload) {
    return this.deposits.confirm(id, dto, user);
  }

  @Post(':id/deposit/email')
  @HttpCode(HttpStatus.OK)
  depositEmail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.deposits.sendEmail(id, user);
  }

  @Get(':id/deposit/pdf')
  async depositPdf(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const { buffer, name } = await this.deposits.pdf(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    res.send(buffer);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.cancel(id, user);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  noShow(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.noShow(id, user);
  }

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  checkIn(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.checkIn(id, user);
  }

  @Post(':id/check-out')
  @HttpCode(HttpStatus.OK)
  checkOut(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reservationsService.checkOut(id, user);
  }
}

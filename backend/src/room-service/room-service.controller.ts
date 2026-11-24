import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles, SalesAccess } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import {
  PairDto,
  RejectDto,
  ReservationRoomServiceDto,
  RoomDeviceDto,
  RoomOrderDto,
  RoomServiceService,
  RoomServiceSettingsDto,
  UpdateRoomDeviceDto,
} from './room-service.service';

const DEVICE_HEADER = 'x-room-device';

@Public()
@Controller('room-device')
export class RoomDeviceController {
  constructor(private readonly service: RoomServiceService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('pair')
  @HttpCode(HttpStatus.OK)
  pair(@Body() dto: PairDto) {
    return this.service.pair(dto);
  }

  @Get('session')
  async session(@Headers(DEVICE_HEADER) token: string | undefined) {
    return this.service.session(await this.service.authenticate(token));
  }

  @Get('menu')
  async menu(@Headers(DEVICE_HEADER) token: string | undefined) {
    return this.service.menu(await this.service.authenticate(token));
  }

  @Get('orders')
  async orders(@Headers(DEVICE_HEADER) token: string | undefined) {
    return this.service.deviceOrders(await this.service.authenticate(token));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('orders')
  async place(@Headers(DEVICE_HEADER) token: string | undefined, @Body() dto: RoomOrderDto) {
    return this.service.placeOrder(await this.service.authenticate(token), dto);
  }
}

@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('room-devices')
export class RoomDevicesController {
  constructor(private readonly service: RoomServiceService) {}

  @Get('settings')
  settings(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.service.settings(query, user);
  }

  @Patch('settings')
  updateSettings(@Body() dto: RoomServiceSettingsDto, @CurrentUser() user: JwtPayload) {
    return this.service.updateSettings(dto, user);
  }

  @Get()
  list(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.service.devices(query, user);
  }

  @Post()
  create(@Body() dto: RoomDeviceDto, @CurrentUser() user: JwtPayload) {
    return this.service.createDevice(dto, user);
  }

  @Post(':id/code')
  @HttpCode(HttpStatus.OK)
  code(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.pairingCode(id, user);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoomDeviceDto, @CurrentUser() user: JwtPayload) {
    return this.service.updateDevice(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.removeDevice(id, user);
  }
}

@SalesAccess()
@Controller('room-orders')
export class RoomOrdersController {
  constructor(private readonly service: RoomServiceService) {}

  @Get()
  list(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.service.roomOrders(query, user);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.accept(id, user);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectDto, @CurrentUser() user: JwtPayload) {
    return this.service.reject(id, dto.reason, user);
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  dispatch(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.dispatch(id, user);
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  deliver(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.deliver(id, user);
  }
}

@Controller('reservations')
export class ReservationRoomServiceController {
  constructor(private readonly service: RoomServiceService) {}

  @Patch(':id/room-service')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: ReservationRoomServiceDto, @CurrentUser() user: JwtPayload) {
    return this.service.reservationSettings(id, dto, user);
  }
}

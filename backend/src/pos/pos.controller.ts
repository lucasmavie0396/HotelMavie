import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { PrepStation } from '@prisma/client';
import { IsString, Length } from 'class-validator';
import type { Response } from 'express';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { resolveHotelScope } from '../common/hotel-scope';
import { CloseOrderDto, KdsQueryDto, KdsReadyDto, MoveItemsDto, OpenOrderDto, OrderItemDto, OrderQueryDto, PosService } from './pos.service';

class VoidItemDto {
  @IsString()
  @Length(3, 200)
  reason: string;
}

function sendPdf(res: Response, buffer: Buffer, name: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
  res.send(buffer);
}

@Controller('kds')
export class KdsController {
  constructor(private readonly pos: PosService) {}

  @Get()
  list(@Query() query: KdsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.pos.kds(query, user);
  }

  @Get('printing')
  printing(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    if (!hotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    return { stations: this.pos.printingStations(hotelId) };
  }

  @Post('ready')
  @HttpCode(HttpStatus.OK)
  ready(@Body() dto: KdsReadyDto, @CurrentUser() user: JwtPayload) {
    return this.pos.markReady(dto, user);
  }
}

@Controller('orders')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get()
  findAll(@Query() query: OrderQueryDto, @CurrentUser() user: JwtPayload) {
    return this.pos.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.pos.findOne(id, user);
  }

  @Post()
  open(@Body() dto: OpenOrderDto, @CurrentUser() user: JwtPayload) {
    return this.pos.open(dto, user);
  }

  @Post(':id/items')
  addItem(@Param('id', ParseIntPipe) id: number, @Body() dto: OrderItemDto, @CurrentUser() user: JwtPayload) {
    return this.pos.addItem(id, dto, user);
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pos.removeItem(id, itemId, user);
  }

  @Post(':id/items/:itemId/void')
  @HttpCode(HttpStatus.OK)
  voidItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: VoidItemDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pos.voidItem(id, itemId, dto.reason, user);
  }

  @Get(':id/items/:itemId/void-ticket')
  async voidTicket(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.pos.voidTicket(id, itemId, user), `anulacao-${id}-${itemId}`);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  send(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.pos.send(id, user);
  }

  @Get(':id/ticket')
  async ticket(
    @Param('id', ParseIntPipe) id: number,
    @Query('station', new ParseEnumPipe(PrepStation)) station: PrepStation,
    @Query('sentAt') sentAt: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.pos.ticket(id, station, sentAt, user), `pedido-${id}-${station.toLowerCase()}`);
  }

  @Get(':id/prebill')
  async prebill(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    sendPdf(res, await this.pos.prebill(id, user), `consulta-${id}`);
  }

  @Post(':id/move-items')
  @HttpCode(HttpStatus.OK)
  moveItems(@Param('id', ParseIntPipe) id: number, @Body() dto: MoveItemsDto, @CurrentUser() user: JwtPayload) {
    return this.pos.moveItems(id, dto, user);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@Param('id', ParseIntPipe) id: number, @Body() dto: CloseOrderDto, @CurrentUser() user: JwtPayload) {
    return this.pos.close(id, dto, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.pos.cancel(id, user);
  }
}

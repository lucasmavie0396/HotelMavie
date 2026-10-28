import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CloseOrderDto, OpenOrderDto, OrderItemDto, OrderQueryDto, PosService } from './pos.service';

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

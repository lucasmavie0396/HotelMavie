import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { AdjustStockDto, CreateWarehouseDto, MovementQueryDto, StockService, TransferDto, WasteDto } from './stock.service';

@Controller()
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('warehouses')
  warehouses(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.stock.warehouses(query, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('warehouses')
  createWarehouse(@Body() dto: CreateWarehouseDto, @CurrentUser() user: JwtPayload) {
    return this.stock.createWarehouse(dto, user);
  }

  @Get('warehouses/:id/stock')
  levels(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.stock.levels(id, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('warehouses/:id/adjust')
  adjust(@Param('id', ParseIntPipe) id: number, @Body() dto: AdjustStockDto, @CurrentUser() user: JwtPayload) {
    return this.stock.adjust(id, dto, user);
  }

  @Post('warehouses/:id/waste')
  waste(@Param('id', ParseIntPipe) id: number, @Body() dto: WasteDto, @CurrentUser() user: JwtPayload) {
    return this.stock.waste(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('warehouses/:id/transfer')
  transfer(@Param('id', ParseIntPipe) id: number, @Body() dto: TransferDto, @CurrentUser() user: JwtPayload) {
    return this.stock.transfer(id, dto, user);
  }

  @Get('stock-movements')
  movements(@Query() query: MovementQueryDto, @CurrentUser() user: JwtPayload) {
    return this.stock.movements(query, user);
  }
}

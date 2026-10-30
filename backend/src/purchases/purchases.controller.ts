import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { PaperWidth, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { StockPdfQueryDto } from '../stock/stock-documents.service';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { PurchaseDto, PurchaseQueryDto, PurchasesService, ReceiveDto, SuggestionQueryDto, SupplierDto, UpdateSupplierDto } from './purchases.service';

@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller()
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get('suppliers')
  suppliers(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.suppliers(query, user);
  }

  @Post('suppliers')
  createSupplier(@Body() dto: SupplierDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.createSupplier(dto, user);
  }

  @Patch('suppliers/:id')
  updateSupplier(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSupplierDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.updateSupplier(id, dto, user);
  }

  @Get('purchases')
  findAll(@Query() query: PurchaseQueryDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.findAll(query, user);
  }

  @Get('purchases/suggestions')
  suggestions(@Query() query: SuggestionQueryDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.suggestions(query, user);
  }

  @Get('purchases/:id/pdf')
  async pdf(@Param('id', ParseIntPipe) id: number, @Query() query: StockPdfQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const { buffer, name } = await this.purchases.pdf(id, query.paper ?? PaperWidth.A4, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    res.send(buffer);
  }

  @Post('purchases/:id/send')
  @HttpCode(HttpStatus.OK)
  send(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.purchases.send(id, user);
  }

  @Post('purchases/:id/close')
  @HttpCode(HttpStatus.OK)
  close(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.purchases.close(id, user);
  }

  @Get('purchases/:id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.purchases.findOne(id, user);
  }

  @Post('purchases')
  create(@Body() dto: PurchaseDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.create(dto, user);
  }

  @Patch('purchases/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: PurchaseDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.update(id, dto, user);
  }

  @Post('purchases/:id/receive')
  @HttpCode(HttpStatus.OK)
  receive(@Param('id', ParseIntPipe) id: number, @Body() dto: ReceiveDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.receive(id, dto, user);
  }

  @Post('purchases/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.purchases.cancel(id, user);
  }
}

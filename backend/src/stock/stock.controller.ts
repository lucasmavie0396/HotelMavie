import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { PaperWidth, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { CountSheetQueryDto, StockDocumentDto, StockDocumentQueryDto, StockDocumentsService, StockPdfQueryDto } from './stock-documents.service';
import { AdjustStockDto, CreateWarehouseDto, LotQueryDto, MovementQueryDto, StockService, TransferDto, WasteDto } from './stock.service';

@Controller()
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly documents: StockDocumentsService,
  ) {}

  @Get('stock-documents')
  findDocuments(@Query() query: StockDocumentQueryDto, @CurrentUser() user: JwtPayload) {
    return this.documents.findAll(query, user);
  }

  @Get('stock-documents/:id')
  findDocument(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.documents.findOne(id, user);
  }

  @Get('stock-documents/:id/pdf')
  async documentPdf(@Param('id', ParseIntPipe) id: number, @Query() query: StockPdfQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const { buffer, name } = await this.documents.pdf(id, query.paper ?? PaperWidth.A4, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    res.send(buffer);
  }

  @Get('warehouses/:id/count-sheet')
  async countSheet(@Param('id', ParseIntPipe) id: number, @Query() query: CountSheetQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const buffer = await this.documents.countSheet(id, query.withQuantities ?? false, query.paper ?? PaperWidth.A4, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="folha-de-contagem.pdf"');
    res.send(buffer);
  }

  @Get('warehouses/:id/lots')
  lots(@Param('id', ParseIntPipe) id: number, @Query() query: LotQueryDto, @CurrentUser() user: JwtPayload) {
    return this.stock.lots(id, query.productId, user);
  }

  @Post('stock-documents')
  createDocument(@Body() dto: StockDocumentDto, @CurrentUser() user: JwtPayload) {
    return this.documents.create(dto, user);
  }

  @Patch('stock-documents/:id')
  updateDocument(@Param('id', ParseIntPipe) id: number, @Body() dto: StockDocumentDto, @CurrentUser() user: JwtPayload) {
    return this.documents.update(id, dto, user);
  }

  @Post('stock-documents/:id/post')
  @HttpCode(HttpStatus.OK)
  postDocument(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.documents.post(id, user);
  }

  @Post('stock-documents/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelDocument(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.documents.cancel(id, user);
  }

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

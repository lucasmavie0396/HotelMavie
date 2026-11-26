import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { ProductImportDto, ProductsExcelService } from './products-excel.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(res: Response, buffer: Buffer, name: string) {
  res.setHeader('Content-Type', XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buffer);
}

@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('products')
export class ProductsExcelController {
  constructor(private readonly excel: ProductsExcelService) {}

  @Get('export.xlsx')
  async export(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    sendXlsx(res, await this.excel.exportProducts(query.hotelId, user), 'produtos.xlsx');
  }

  @Get('import-template.xlsx')
  async template(@Res() res: Response) {
    sendXlsx(res, await this.excel.template(), 'modelo-importacao-produtos.xlsx');
  }

  @Post('import/check')
  @HttpCode(HttpStatus.OK)
  check(@Body() dto: ProductImportDto, @CurrentUser() user: JwtPayload) {
    return this.excel.check(dto, user);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  apply(@Body() dto: ProductImportDto, @CurrentUser() user: JwtPayload) {
    return this.excel.apply(dto, user);
  }
}

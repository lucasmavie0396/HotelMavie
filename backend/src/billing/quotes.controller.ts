import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CancelQuoteDto, ConvertQuoteDto, CreateQuoteDto, QuoteQueryDto } from './documents.dto';
import { QuotesService } from './quotes.service';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  findAll(@Query() query: QuoteQueryDto, @CurrentUser() user: JwtPayload) {
    return this.quotes.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.quotes.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateQuoteDto, @CurrentUser() user: JwtPayload) {
    return this.quotes.create(dto, user);
  }

  @Post(':id/convert')
  convert(@Param('id', ParseIntPipe) id: number, @Body() dto: ConvertQuoteDto, @CurrentUser() user: JwtPayload) {
    return this.quotes.convert(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelQuoteDto, @CurrentUser() user: JwtPayload) {
    return this.quotes.cancel(id, dto, user);
  }
}

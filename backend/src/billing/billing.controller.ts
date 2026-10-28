import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChargeDto, CreatePaymentDto, CreditNoteDto, InvoiceQueryDto, IssueInvoiceDto } from './billing.dto';
import {
  CashMovementDto,
  CashService,
  CloseSessionDto,
  CreateRegisterDto,
  OpenSessionDto,
  RegisterQueryDto,
} from './cash.service';
import { FolioService } from './folio.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';

@Controller()
export class BillingController {
  constructor(
    private readonly folio: FolioService,
    private readonly invoices: InvoicesService,
    private readonly pdf: InvoicePdfService,
    private readonly cash: CashService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('reservations/:id/folio')
  getFolio(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.folio.getFolio(id, user);
  }

  @Post('reservations/:id/charges')
  addCharge(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateChargeDto, @CurrentUser() user: JwtPayload) {
    return this.folio.addCharge(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete('charges/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCharge(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.folio.removeCharge(id, user);
  }

  @Post('reservations/:id/payments')
  addPayment(@Param('id', ParseIntPipe) id: number, @Body() dto: CreatePaymentDto, @CurrentUser() user: JwtPayload) {
    return this.folio.addPayment(id, dto, user);
  }

  @Post('reservations/:id/invoices')
  issue(@Param('id', ParseIntPipe) id: number, @Body() dto: IssueInvoiceDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.issueForReservation(id, dto, user);
  }

  @Get('invoices')
  findInvoices(@Query() query: InvoiceQueryDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.findAll(query, user);
  }

  @Get('invoices/:id')
  findInvoice(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.invoices.findOne(id, user);
  }

  @Get('invoices/:id/pdf')
  async invoicePdf(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const invoice = await this.invoices.findOne(id, user);
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: invoice.hotelId } });
    const buffer = await this.pdf.render(invoice, hotel);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.fullNumber.replace('/', '-')}.pdf"`);
    res.send(buffer);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('invoices/:id/credit-note')
  creditNote(@Param('id', ParseIntPipe) id: number, @Body() dto: CreditNoteDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.creditNote(id, dto, user);
  }

  @Get('cash-registers')
  registers(@Query() query: RegisterQueryDto, @CurrentUser() user: JwtPayload) {
    return this.cash.findRegisters(query, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('cash-registers')
  createRegister(@Body() dto: CreateRegisterDto, @CurrentUser() user: JwtPayload) {
    return this.cash.createRegister(dto, user);
  }

  @Post('cash-registers/:id/open')
  open(@Param('id', ParseIntPipe) id: number, @Body() dto: OpenSessionDto, @CurrentUser() user: JwtPayload) {
    return this.cash.open(id, dto, user);
  }

  @Get('cash-registers/:id/sessions')
  sessions(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.cash.sessions(id, user);
  }

  @Get('cash-sessions/:id')
  session(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.cash.session(id, user);
  }

  @Post('cash-sessions/:id/movements')
  movement(@Param('id', ParseIntPipe) id: number, @Body() dto: CashMovementDto, @CurrentUser() user: JwtPayload) {
    return this.cash.addMovement(id, dto, user);
  }

  @Post('cash-sessions/:id/close')
  @HttpCode(HttpStatus.OK)
  close(@Param('id', ParseIntPipe) id: number, @Body() dto: CloseSessionDto, @CurrentUser() user: JwtPayload) {
    return this.cash.close(id, dto, user);
  }
}

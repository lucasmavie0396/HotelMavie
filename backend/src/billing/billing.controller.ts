import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { PaperWidth, UserRole } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsOptional } from 'class-validator';
import { MailService } from '../mail/mail.service';
import { invoiceEmail, MailLang, mailLang } from '../mail/templates';
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
import { DocumentsService } from './documents.service';
import { TicketPdfService } from './ticket-pdf.service';
import { CancelReceiptDto, CreateReceiptDto, OpenInvoicesQueryDto, ReceiptsService } from './receipts.service';
import { HotelQueryDto } from '../common/hotel-query.dto';

export class PaperQueryDto {
  @IsOptional()
  @IsEnum(PaperWidth)
  paper?: PaperWidth;

  @IsOptional()
  @IsIn(['ticket'])
  format?: string;

  @IsOptional()
  @IsIn(['pt', 'en'])
  lang?: MailLang;
}

class EmailInvoiceDto {
  @IsOptional()
  @IsEmail()
  to?: string;

  @IsOptional()
  @IsIn(['pt', 'en'])
  lang?: MailLang;
}

@Controller()
export class BillingController {
  constructor(
    private readonly folio: FolioService,
    private readonly invoices: InvoicesService,
    private readonly pdf: InvoicePdfService,
    private readonly cash: CashService,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly receipts: ReceiptsService,
    private readonly tickets: TicketPdfService,
    private readonly documents: DocumentsService,
  ) {}

  private sendPdf(res: Response, buffer: Buffer, name: string) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name.replace(/[^\w-]+/g, '-')}.pdf"`);
    res.send(buffer);
  }

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

  @Get('reservations/:id/statement')
  async statement(@Param('id', ParseIntPipe) id: number, @Query() query: PaperQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const { ticket } = await this.documents.statement(id, user);
    this.sendPdf(res, await this.tickets.render(ticket, query.paper), `conta-${id}`);
  }

  @Get('payments/:id/slip')
  async paymentSlip(@Param('id', ParseIntPipe) id: number, @Query() query: PaperQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const { ticket } = await this.documents.payment(id, user);
    this.sendPdf(res, await this.tickets.render(ticket, query.paper), `pagamento-${id}`);
  }

  @Get('invoices/:id/pdf')
  async invoicePdf(@Param('id', ParseIntPipe) id: number, @Query() query: PaperQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const invoice = await this.invoices.findOne(id, user);
    if (query.format === 'ticket' || query.paper === PaperWidth.MM58 || query.paper === PaperWidth.MM80) {
      const { ticket } = await this.documents.invoice(id, user);
      return this.sendPdf(res, await this.tickets.render(ticket, query.paper ?? PaperWidth.MM80), invoice.fullNumber);
    }
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: invoice.hotelId } });
    this.sendPdf(res, await this.pdf.render(invoice, hotel, query.lang ?? (await this.guestLang(invoice.reservationId))), invoice.fullNumber);
  }

  private async guestLang(reservationId: number | null) {
    if (!reservationId) return 'pt' as const;
    const reservation = await this.prisma.reservation.findUnique({ where: { id: reservationId }, select: { locale: true } });
    return mailLang(reservation?.locale);
  }

  @Post('invoices/:id/email')
  @HttpCode(HttpStatus.OK)
  async emailInvoice(@Param('id', ParseIntPipe) id: number, @Body() dto: EmailInvoiceDto, @CurrentUser() user: JwtPayload) {
    const invoice = await this.invoices.findOne(id, user);
    const to = dto.to ?? invoice.customerEmail;
    if (!to) {
      throw new BadRequestException('O documento nao tem email do cliente: indica o destinatario');
    }
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: invoice.hotelId } });
    const lang = dto.lang ?? (await this.guestLang(invoice.reservationId));
    const content = invoiceEmail(hotel, invoice, lang);
    const log = await this.mail.send({
      hotelId: hotel.id,
      kind: 'INVOICE',
      to,
      replyTo: hotel.email,
      relatedId: invoice.id,
      ...content,
      attachments: [
        { filename: `${invoice.fullNumber.replace(/[^\w-]+/g, '-')}.pdf`, content: await this.pdf.render(invoice, hotel, lang), contentType: 'application/pdf' },
      ],
    });
    if (log.status === 'FAILED') {
      throw new BadGatewayException(`Nao foi possivel enviar o email: ${log.error}`);
    }
    return log;
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('invoices/:id/credit-note')
  creditNote(@Param('id', ParseIntPipe) id: number, @Body() dto: CreditNoteDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.creditNote(id, dto, user);
  }

  @Get('accounts')
  accounts(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.receipts.accounts(query, user);
  }

  @Get('invoices-open')
  openInvoices(@Query() query: OpenInvoicesQueryDto, @CurrentUser() user: JwtPayload) {
    return this.receipts.openInvoices(query, user);
  }

  @Get('receipts')
  findReceipts(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.receipts.findAll(query, user);
  }

  @Post('receipts')
  issueReceipt(@Body() dto: CreateReceiptDto, @CurrentUser() user: JwtPayload) {
    return this.receipts.issue(dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('receipts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelReceipt(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelReceiptDto, @CurrentUser() user: JwtPayload) {
    return this.receipts.cancel(id, dto, user);
  }

  @Get('receipts/:id/pdf')
  async receiptPdf(@Param('id', ParseIntPipe) id: number, @Query() query: PaperQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const receipt = await this.receipts.findOne(id, user);
    if (query.format === 'ticket' || query.paper === PaperWidth.MM58 || query.paper === PaperWidth.MM80) {
      const { ticket } = await this.documents.receipt(id, user);
      return this.sendPdf(res, await this.tickets.render(ticket, query.paper ?? PaperWidth.MM80), receipt.fullNumber);
    }
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: receipt.hotelId } });
    this.sendPdf(res, await this.pdf.renderReceipt(receipt, hotel, query.lang ?? 'pt'), receipt.fullNumber);
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

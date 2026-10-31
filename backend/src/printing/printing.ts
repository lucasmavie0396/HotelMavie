import {
  BadGatewayException,
  BadRequestException,
  Body,
  ForbiddenException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { PaperWidth, PrepStation, Printer, PrinterConnection, PrinterOutput, PrinterPurpose, UserRole } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { createConnection } from 'node:net';
import { JwtPayload } from '../auth/jwt-payload';
import { DocumentsService } from '../billing/documents.service';
import { Ticket, TicketPdfService } from '../billing/ticket-pdf.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles, SalesAccess } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PosService } from '../pos/pos.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportBuilderService } from '../reports/report-builder.service';
import { ReportRenderService } from '../reports/report-render.service';

export const DOCUMENTS = ['ORDER', 'VOID', 'PREBILL', 'STATEMENT', 'INVOICE', 'RECEIPT', 'PAYMENT', 'TEST', 'REPORT'] as const;
export type PrintDocument = (typeof DOCUMENTS)[number];
const CASHIER_DOCUMENTS: PrintDocument[] = ['ORDER', 'VOID', 'PREBILL', 'INVOICE', 'REPORT'];

const STATION_PURPOSE: Record<PrepStation, PrinterPurpose> = {
  KITCHEN: PrinterPurpose.KITCHEN,
  BAR: PrinterPurpose.BAR,
  NONE: PrinterPurpose.OTHER,
};

const PURPOSE_LABELS: Record<PrinterPurpose, string> = {
  RECEIPT: 'Recibos e contas',
  KITCHEN: 'Cozinha',
  BAR: 'Bar',
  OTHER: 'Outra',
};

export class PrinterDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @MaxLength(60)
  name: string;

  @IsEnum(PrinterPurpose)
  purpose: PrinterPurpose;

  @IsOptional()
  @IsEnum(PrinterConnection)
  connection?: PrinterConnection;

  @ValidateIf((dto: PrinterDto) => dto.connection === PrinterConnection.NETWORK)
  @Matches(/^[A-Za-z0-9.-]{1,100}$/, { message: 'Endereco IP ou nome da impressora invalido' })
  host?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ValidateIf((dto: PrinterDto) => dto.connection === PrinterConnection.LOCAL)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  localName?: string | null;

  @IsOptional()
  @IsEnum(PaperWidth)
  paperWidth?: PaperWidth;

  @IsOptional()
  @IsEnum(PrinterOutput)
  output?: PrinterOutput;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  copies?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdatePrinterDto extends PartialType(OmitType(PrinterDto, ['hotelId'] as const)) {}

const nullableInt = ({ value }: { value: unknown }) => (value === 'null' || value === null ? null : value === undefined || value === '' ? undefined : Number(value));

export class PrintDto {
  @IsIn(DOCUMENTS)
  document: PrintDocument;

  @IsOptional() @Type(() => Number) @IsInt() orderId?: number;
  @IsOptional() @Type(() => Number) @IsInt() itemId?: number;
  @IsOptional() @Type(() => Number) @IsInt() reservationId?: number;
  @IsOptional() @Type(() => Number) @IsInt() invoiceId?: number;
  @IsOptional() @Type(() => Number) @IsInt() receiptId?: number;
  @IsOptional() @Type(() => Number) @IsInt() paymentId?: number;
  @IsOptional() @Transform(nullableInt) @IsInt() printerId?: number | null;
  @IsOptional() @IsEnum(PrepStation) station?: PrepStation;
  @IsOptional() @IsISO8601() sentAt?: string;
  @IsOptional() @IsEnum(PaperWidth) paper?: PaperWidth;
  @IsOptional() @IsString() @MaxLength(30) report?: string;
  @IsOptional() @Type(() => Number) @IsInt() hotelId?: number;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @Type(() => Number) @IsInt() warehouseId?: number;
  @IsOptional() @Type(() => Number) @IsInt() sessionId?: number;
}

interface Built {
  ticket: Ticket;
  hotelId: number;
  purpose: PrinterPurpose;
  printerId?: number | null;
  name: string;
}

export function sendRaw(host: string, port: number, data: Buffer, timeoutMs = 5000) {
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => socket.destroy(new Error('Sem resposta da impressora')), timeoutMs);
    socket.on('connect', () => socket.end(data));
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('close', (hadError) => {
      clearTimeout(timer);
      if (!hadError) resolve();
    });
  });
}

@Injectable()
export class PrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly pos: PosService,
    private readonly tickets: TicketPdfService,
    private readonly reports: ReportBuilderService,
    private readonly reportRender: ReportRenderService,
  ) {}

  async build(dto: PrintDto, user: JwtPayload): Promise<Built> {
    if (user.role === UserRole.CASHIER && !CASHIER_DOCUMENTS.includes(dto.document)) {
      throw new ForbiddenException('Sem permissao para esta operacao');
    }
    const need = <T>(value: T | undefined, field: string) => {
      if (value === undefined || value === null) throw new BadRequestException(`Falta ${field}`);
      return value;
    };
    switch (dto.document) {
      case 'ORDER': {
        const built = await this.pos.buildTicket(need(dto.orderId, 'orderId'), dto.station ?? PrepStation.KITCHEN, dto.printerId, dto.sentAt, user);
        return { ...built, purpose: STATION_PURPOSE[built.station], name: `pedido-${dto.orderId}` };
      }
      case 'VOID': {
        const built = await this.pos.buildVoidTicket(need(dto.orderId, 'orderId'), need(dto.itemId, 'itemId'), user);
        return { ...built, purpose: STATION_PURPOSE[built.station], name: `anulacao-${dto.itemId}` };
      }
      case 'PREBILL':
        return { ...(await this.pos.buildPrebill(need(dto.orderId, 'orderId'), user)), purpose: PrinterPurpose.RECEIPT, name: `consulta-${dto.orderId}` };
      case 'STATEMENT':
        return { ...(await this.documents.statement(need(dto.reservationId, 'reservationId'), user)), purpose: PrinterPurpose.RECEIPT, name: `conta-${dto.reservationId}` };
      case 'INVOICE':
        return { ...(await this.documents.invoice(need(dto.invoiceId, 'invoiceId'), user)), purpose: PrinterPurpose.RECEIPT, name: `fatura-${dto.invoiceId}` };
      case 'RECEIPT':
        return { ...(await this.documents.receipt(need(dto.receiptId, 'receiptId'), user)), purpose: PrinterPurpose.RECEIPT, name: `recibo-${dto.receiptId}` };
      case 'PAYMENT':
        return { ...(await this.documents.payment(need(dto.paymentId, 'paymentId'), user)), purpose: PrinterPurpose.RECEIPT, name: `pagamento-${dto.paymentId}` };
      case 'REPORT': {
        const report = await this.buildReport(dto, user);
        return { ticket: await this.reportRender.ticket(report), hotelId: report.hotel.id, purpose: PrinterPurpose.RECEIPT, name: `relatorio-${report.key}` };
      }
      case 'TEST': {
        const printer = await this.findPrinter(need(dto.printerId, 'printerId'), user);
        const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: printer.hotelId } });
        const ticket = new Ticket(hotel.currency).header(hotel);
        ticket.text('PAGINA DE TESTE', { bold: true, size: 13, align: 'center' });
        ticket.cols('Impressora', printer.name);
        ticket.cols('Finalidade', PURPOSE_LABELS[printer.purpose]);
        ticket.cols('Papel', printer.paperWidth);
        ticket.cols('Hora', Ticket.when(new Date()));
        ticket.rule();
        ticket.text('Acentos: acao, cafe, pao (sem acentos na termica)', { size: 8 });
        ticket.cols('Valor de exemplo', ticket.money(1234.5), { bold: true });
        ticket.qr('MAVIE-HGest teste de impressora', 90);
        return { ticket, hotelId: printer.hotelId, purpose: printer.purpose, printerId: printer.id, name: 'teste' };
      }
    }
  }

  async choosePrinter(hotelId: number, purpose: PrinterPurpose, printerId?: number | null) {
    if (printerId) {
      const printer = await this.prisma.printer.findUnique({ where: { id: printerId } });
      if (printer && printer.hotelId === hotelId && printer.active) return printer;
    }
    return this.prisma.printer.findFirst({
      where: { hotelId, purpose, active: true },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
  }

  async print(dto: PrintDto, user: JwtPayload) {
    const built = await this.build(dto, user);
    const printer = await this.choosePrinter(built.hotelId, built.purpose, dto.document === 'TEST' ? built.printerId : built.printerId ?? dto.printerId);
    if (printer?.output === PrinterOutput.PDF) {
      return {
        status: 'pdf' as const,
        paper: printer.paperWidth,
        copies: printer.copies,
        printer: { id: printer.id, name: printer.name },
      };
    }
    if (printer?.connection === PrinterConnection.NETWORK && printer.host) {
      const paper = printer.paperWidth === PaperWidth.A4 ? PaperWidth.MM80 : printer.paperWidth;
      const bytes = this.tickets.escpos(built.ticket, paper);
      try {
        await sendRaw(printer.host, printer.port, Buffer.concat(Array.from({ length: printer.copies }, () => bytes)));
      } catch (error) {
        throw new BadGatewayException(`A impressora ${printer.name} (${printer.host}:${printer.port}) nao respondeu: ${(error as Error).message}`);
      }
      return { status: 'printed' as const, printer: { id: printer.id, name: printer.name } };
    }
    if (printer?.connection === PrinterConnection.LOCAL && printer.localName && printer.paperWidth !== PaperWidth.A4) {
      const bytes = this.tickets.escpos(built.ticket, printer.paperWidth);
      return {
        status: 'local' as const,
        printer: { id: printer.id, name: printer.name, localName: printer.localName },
        copies: printer.copies,
        data: bytes.toString('base64'),
      };
    }
    return {
      status: 'browser' as const,
      paper: printer?.paperWidth ?? (built.purpose === PrinterPurpose.RECEIPT ? PaperWidth.MM80 : PaperWidth.MM80),
      copies: printer?.copies ?? 1,
      printer: printer ? { id: printer.id, name: printer.name } : null,
    };
  }

  buildReport(dto: PrintDto, user: JwtPayload) {
    if (!dto.report) throw new BadRequestException('Falta report');
    return this.reports.build(dto.report, { hotelId: dto.hotelId, from: dto.from, to: dto.to, date: dto.date, warehouseId: dto.warehouseId, sessionId: dto.sessionId }, user);
  }

  async pdf(dto: PrintDto, user: JwtPayload) {
    if (dto.document === 'REPORT' && dto.paper === PaperWidth.A4) {
      const report = await this.buildReport(dto, user);
      return { buffer: await this.reportRender.pdf(report, PaperWidth.A4), name: `relatorio-${report.key}` };
    }
    const built = await this.build(dto, user);
    const printer = dto.paper ? null : await this.choosePrinter(built.hotelId, built.purpose, built.printerId ?? dto.printerId);
    return { buffer: await this.tickets.render(built.ticket, dto.paper ?? printer?.paperWidth ?? PaperWidth.MM80), name: built.name };
  }

  async findPrinter(id: number, user: JwtPayload) {
    const printer = await this.prisma.printer.findUnique({ where: { id } });
    if (!printer || !canAccessHotel(user, printer.hotelId)) {
      throw new NotFoundException('Impressora nao encontrada');
    }
    return printer;
  }
}

@Controller()
export class PrintingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly printing: PrintService,
  ) {}

  @Get('printers')
  printers(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.prisma.printer.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId) },
      orderBy: [{ active: 'desc' }, { purpose: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('printers')
  async create(@Body() { hotelId, ...data }: PrinterDto, @CurrentUser() user: JwtPayload) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) throw new BadRequestException('hotelId e obrigatorio');
    return this.prisma.$transaction(async (tx) => {
      const first = !(await tx.printer.count({ where: { hotelId: scoped, purpose: data.purpose } }));
      if (data.isDefault) await tx.printer.updateMany({ where: { hotelId: scoped, purpose: data.purpose }, data: { isDefault: false } });
      return tx.printer.create({ data: { ...data, hotelId: scoped, isDefault: data.isDefault ?? first } });
    });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch('printers/:id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePrinterDto, @CurrentUser() user: JwtPayload) {
    const printer: Printer = await this.printing.findPrinter(id, user);
    const connection = dto.connection ?? printer.connection;
    const host = dto.host === undefined ? printer.host : dto.host;
    if (connection === PrinterConnection.NETWORK && !host) {
      throw new BadRequestException('Uma impressora de rede precisa do endereco IP');
    }
    if (connection === PrinterConnection.LOCAL && !(dto.localName === undefined ? printer.localName : dto.localName)) {
      throw new BadRequestException('Escolhe a impressora instalada no computador');
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.printer.updateMany({ where: { hotelId: printer.hotelId, purpose: dto.purpose ?? printer.purpose, id: { not: id } }, data: { isDefault: false } });
      }
      return tx.printer.update({ where: { id }, data: dto });
    });
  }

  @Post('printers/:id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.printing.print({ document: 'TEST', printerId: id }, user);
  }

  @SalesAccess()
  @Post('print')
  @HttpCode(HttpStatus.OK)
  print(@Body() dto: PrintDto, @CurrentUser() user: JwtPayload) {
    return this.printing.print(dto, user);
  }

  @SalesAccess()
  @Get('print/pdf')
  async pdf(@Query() dto: PrintDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const { buffer, name } = await this.printing.pdf(dto, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    res.send(buffer);
  }
}

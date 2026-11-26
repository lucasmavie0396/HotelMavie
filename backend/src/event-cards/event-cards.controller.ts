import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { EventCardMovementType, PaperWidth, UserRole } from '@prisma/client';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt } from 'class-validator';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { JwtPayload } from '../auth/jwt-payload';
import { Ticket } from '../billing/ticket-pdf.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles, SalesAccess } from '../common/decorators/roles.decorator';
import { canAccessHotel } from '../common/hotel-scope';
import { formatCurrency } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { ReportRenderService } from '../reports/report-render.service';
import { StockPdfQueryDto } from '../stock/stock-documents.service';
import {
  CardActiveDto,
  CardGuestDto,
  CardListQueryDto,
  CardLookupDto,
  CardMovementsQueryDto,
  CardRefundDto,
  CardTransferDto,
  DischargeDto,
  DischargeQueryDto,
  EventCardsService,
  RegisterCardDto,
  TopUpDto,
} from './event-cards.service';

class LabelsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  ids: number[];
}

const MOVEMENT_LABELS: Record<EventCardMovementType, string> = {
  LOAD: 'Carregamento',
  TOPUP: 'Recarga',
  PAYMENT: 'Pagamento',
  REFUND: 'Devolucao ao cartao',
  DISCHARGE: 'Descarga',
  TRANSFER_OUT: 'Transferencia (saida)',
  TRANSFER_IN: 'Transferencia (entrada)',
  GUEST_CHANGE: 'Mudanca de titular',
};

function sendPdf(res: Response, buffer: Buffer, name: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
  res.send(buffer);
}

@SalesAccess()
@Controller('event-cards')
export class EventCardsController {
  constructor(
    private readonly cards: EventCardsService,
    private readonly prisma: PrismaService,
    private readonly render: ReportRenderService,
  ) {}

  @Get()
  list(@Query() query: CardListQueryDto, @CurrentUser() user: JwtPayload) {
    return this.cards.list(query, user);
  }

  @Get('lookup')
  lookup(@Query() query: CardLookupDto, @CurrentUser() user: JwtPayload) {
    return this.cards.lookup(query, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('discharge/balances')
  dischargeBalances(@Query() query: DischargeQueryDto, @CurrentUser() user: JwtPayload) {
    return this.cards.dischargeBalances(query, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('discharge')
  discharge(@Body() dto: DischargeDto, @CurrentUser() user: JwtPayload) {
    return this.cards.discharge(dto, user);
  }

  @Get('guests/:guestId/statement')
  statement(@Param('guestId', ParseIntPipe) guestId: number, @CurrentUser() user: JwtPayload) {
    return this.cards.guestStatement(guestId, user);
  }

  @Get('movements/:movementId/receipt')
  async receipt(@Param('movementId', ParseIntPipe) movementId: number, @Query() query: StockPdfQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const movement = await this.prisma.eventCardMovement.findUnique({
      where: { id: movementId },
      include: {
        card: { include: { hotel: true, guest: { select: { firstName: true, lastName: true } } } },
        createdBy: { select: { name: true } },
        loadPayment: { select: { reference: true, paymentType: { select: { name: true } }, method: true } },
      },
    });
    if (!movement || !canAccessHotel(user, movement.card.hotelId)) throw new NotFoundException('Movimento nao encontrado');
    const hotel = movement.card.hotel;
    const money = (value: Parameters<typeof formatCurrency>[0]) => formatCurrency(value, hotel.currency);
    const buffer = await this.render.pdf(
      {
        key: 'event-card-receipt',
        title: `${MOVEMENT_LABELS[movement.type]} de cartao`,
        period: `Cartao ${movement.card.number}`,
        generatedAt: Ticket.when(movement.createdAt),
        generatedBy: movement.createdBy?.name ?? '-',
        hotel,
        sections: [
          {
            title: 'Cartao Evento',
            kpis: [
              { label: 'Cartao', value: movement.card.number },
              { label: 'Titular', value: movement.card.guest ? `${movement.card.guest.firstName} ${movement.card.guest.lastName}` : (movement.card.holder ?? '-') },
              { label: 'Operacao', value: MOVEMENT_LABELS[movement.type] },
              { label: 'Valor', value: money(movement.amount) },
              { label: 'Pago por', value: movement.loadPayment?.paymentType?.name ?? movement.loadPayment?.method ?? '-' },
              { label: 'Saldo apos', value: money(movement.balanceAfter) },
            ],
            note: 'Talao sem valor fiscal: a fatura e emitida no consumo.',
          },
        ],
      },
      query.paper ?? PaperWidth.MM80,
    );
    sendPdf(res, buffer, `recibo-cartao-${movement.card.number}`);
  }

  @Post('labels')
  @HttpCode(HttpStatus.OK)
  async labels(@Body() dto: LabelsDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const cards = await this.prisma.eventCard.findMany({ where: { id: { in: dto.ids } }, include: { hotel: { select: { id: true, name: true } } }, orderBy: { number: 'asc' } });
    if (!cards.length || cards.some((card) => !canAccessHotel(user, card.hotelId))) throw new NotFoundException('Cartao nao encontrado');
    const doc = new PDFDocument({ size: 'A4', margin: 28 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    const width = 241;
    const height = 153;
    const gap = 12;
    for (let index = 0; index < cards.length; index++) {
      const slot = index % 8;
      if (index && !slot) doc.addPage();
      const x = 28 + (slot % 2) * (width + gap);
      const y = 28 + Math.floor(slot / 2) * (height + gap);
      const card = cards[index];
      doc.roundedRect(x, y, width, height, 8).lineWidth(0.5).strokeColor('#94a3b8').stroke();
      const qr = await QRCode.toBuffer(card.number, { margin: 0, width: 220 });
      doc.image(qr, x + 12, y + 22, { width: 108, height: 108 });
      doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text(card.hotel.name, x + 130, y + 26, { width: width - 140 });
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text('Cartao Evento', x + 130, y + 58, { width: width - 140 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(card.number, x + 130, y + 78, { width: width - 140 });
      if (card.holder) doc.font('Helvetica').fontSize(9).fillColor('#475569').text(card.holder, x + 130, y + 104, { width: width - 140 });
    }
    doc.end();
    sendPdf(res, await done, 'etiquetas-cartoes');
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.cards.findOne(id, user);
  }

  @Get(':id/movements')
  movements(@Param('id', ParseIntPipe) id: number, @Query() query: CardMovementsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.cards.movements(id, query, user);
  }

  @Post()
  register(@Body() dto: RegisterCardDto, @CurrentUser() user: JwtPayload) {
    return this.cards.register(dto, user);
  }

  @Post(':id/topup')
  @HttpCode(HttpStatus.OK)
  topUp(@Param('id', ParseIntPipe) id: number, @Body() dto: TopUpDto, @CurrentUser() user: JwtPayload) {
    return this.cards.topUp(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/active')
  @HttpCode(HttpStatus.OK)
  setActive(@Param('id', ParseIntPipe) id: number, @Body() dto: CardActiveDto, @CurrentUser() user: JwtPayload) {
    return this.cards.setActive(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.RECEPTION)
  @Post(':id/guest')
  @HttpCode(HttpStatus.OK)
  setGuest(@Param('id', ParseIntPipe) id: number, @Body() dto: CardGuestDto, @CurrentUser() user: JwtPayload) {
    return this.cards.setGuest(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.RECEPTION)
  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  transfer(@Param('id', ParseIntPipe) id: number, @Body() dto: CardTransferDto, @CurrentUser() user: JwtPayload) {
    return this.cards.transfer(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  refund(@Param('id', ParseIntPipe) id: number, @Body() dto: CardRefundDto, @CurrentUser() user: JwtPayload) {
    return this.cards.refund(id, dto, user);
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReservationStatus } from '@prisma/client';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import PDFDocument from 'pdfkit';
import { JwtPayload } from '../auth/jwt-payload';
import { A4, COLORS, Column, drawFooter, drawHeader, infoCard, sectionTitle, tableHeader, tableRow, totalsBox } from '../billing/a4-layout';
import { FolioService } from '../billing/folio.service';
import { nightsBetween } from '../common/dates';
import { canAccessHotel } from '../common/hotel-scope';
import { toMoney } from '../common/money';
import { MailService } from '../mail/mail.service';
import { depositConfirmedEmail, mailLang } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads';

export class ConfirmDepositDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsInt()
  paymentTypeId?: number;

  @IsOptional()
  @IsInt()
  cashSessionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}

const TEXT = {
  pt: {
    status: { PENDING: 'Pendente', CONFIRMED: 'Confirmada', CHECKED_IN: 'Em casa', CHECKED_OUT: 'Terminada', CANCELLED: 'Cancelada', NO_SHOW: 'No-show' } as Record<ReservationStatus, string>,
    title: 'Comprovativo de sinal',
    number: 'N.o',
    date: 'Data',
    booking: 'Reserva',
    guest: 'Hospede',
    name: 'Nome',
    email: 'Email',
    phone: 'Telefone',
    taxId: 'NIF',
    document: 'Documento',
    stay: 'Estadia',
    code: 'Codigo',
    room: 'Quarto',
    roomValue: (type: string, number: string) => `${type} (n.o ${number})`,
    checkIn: 'Entrada',
    checkOut: 'Saida',
    nights: 'Noites',
    guests: 'Hospedes',
    guestsValue: (adults: number, children: number) => `${adults} adulto(s)${children ? `, ${children} crianca(s)` : ''}`,
    amounts: 'Valores',
    description: 'Descricao',
    price: 'Preco',
    total: 'Total',
    lodging: (type: string) => `Alojamento ${type}`,
    payment: 'Pagamento do sinal',
    method: 'Forma',
    reference: 'Referencia',
    confirmedBy: 'Confirmado por',
    bookingTotal: 'Total da reserva',
    received: (percent: number) => `Sinal recebido (${percent}%)`,
    remaining: 'Restante a pagar',
    message: (amount: string) =>
      `O valor restante de ${amount} sera cobrado no check-in ou no check-out, juntamente com os consumos da estadia. A fatura e emitida no check-out e inclui o valor deste sinal.`,
    notes: 'Observacoes',
    notice: 'Documento interno, sem valor fiscal. Nao substitui a fatura.',
  },
  en: {
    status: { PENDING: 'Pending', CONFIRMED: 'Confirmed', CHECKED_IN: 'In house', CHECKED_OUT: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' } as Record<ReservationStatus, string>,
    title: 'Deposit receipt',
    number: 'No.',
    date: 'Date',
    booking: 'Booking',
    guest: 'Guest',
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    taxId: 'Tax no.',
    document: 'Document',
    stay: 'Stay',
    code: 'Code',
    room: 'Room',
    roomValue: (type: string, number: string) => `${type} (no. ${number})`,
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    nights: 'Nights',
    guests: 'Guests',
    guestsValue: (adults: number, children: number) => `${adults} adult(s)${children ? `, ${children} child(ren)` : ''}`,
    amounts: 'Amounts',
    description: 'Description',
    price: 'Price',
    total: 'Total',
    lodging: (type: string) => `Accommodation ${type}`,
    payment: 'Deposit payment',
    method: 'Method',
    reference: 'Reference',
    confirmedBy: 'Confirmed by',
    bookingTotal: 'Booking total',
    received: (percent: number) => `Deposit received (${percent}%)`,
    remaining: 'Balance due',
    message: (amount: string) =>
      `The remaining balance of ${amount} will be charged at check-in or check-out, together with any extras. The invoice is issued at check-out and includes this deposit.`,
    notes: 'Notes',
    notice: 'Internal document with no tax value. It does not replace the invoice.',
  },
};

const depositInclude = {
  hotel: true,
  guest: true,
  room: { select: { number: true, type: true } },
  depositPaymentType: { select: { name: true } },
  depositConfirmedBy: { select: { name: true } },
} satisfies Prisma.ReservationInclude;

type DepositReservation = Prisma.ReservationGetPayload<{ include: typeof depositInclude }>;

function day(date: Date) {
  return date.toISOString().slice(0, 10).split('-').reverse().join('/');
}

@Injectable()
export class DepositService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folio: FolioService,
    private readonly mail: MailService,
    private readonly uploads: UploadsService,
  ) {}

  async confirm(id: number, dto: ConfirmDepositDto, user: JwtPayload) {
    const current = await this.find(id, user);
    await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: ReservationStatus; depositPaymentId: number | null; depositAmount: Prisma.Decimal | null; totalAmount: Prisma.Decimal }[]>`
        SELECT status, depositPaymentId, depositAmount, totalAmount FROM reservations WHERE id = ${id} FOR UPDATE`;
      if (locked.depositPaymentId) {
        throw new ConflictException('O sinal desta reserva ja foi confirmado');
      }
      if (locked.status !== ReservationStatus.PENDING && locked.status !== ReservationStatus.CONFIRMED) {
        throw new ConflictException('So e possivel confirmar o sinal de reservas pendentes ou confirmadas');
      }
      const total = toMoney(locked.totalAmount);
      const amount = toMoney(
        dto.amount ?? (locked.depositAmount !== null ? locked.depositAmount : total.mul(current.hotel.depositPercent).div(100)),
      );
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('Indica o valor do sinal');
      }
      if (amount.greaterThan(total)) {
        throw new BadRequestException('O sinal nao pode ser superior ao total da reserva');
      }
      const reference = dto.reference?.trim() || current.depositReference || undefined;
      const payment = await this.folio.recordPayment(
        tx,
        {
          hotelId: current.hotelId,
          reservationId: id,
          amount,
          paymentTypeId: dto.paymentTypeId ?? current.depositPaymentTypeId,
          cashSessionId: dto.cashSessionId,
          reference,
          notes: 'Sinal da reserva',
          createdById: user.sub,
        },
        user,
      );
      await tx.reservation.update({
        where: { id },
        data: {
          depositAmount: amount,
          depositReference: reference ?? null,
          depositPaymentTypeId: payment.paymentTypeId,
          depositPaymentId: payment.id,
          depositConfirmedAt: new Date(),
          depositConfirmedById: user.sub,
          ...(locked.status === ReservationStatus.PENDING ? { status: ReservationStatus.CONFIRMED } : {}),
        },
      });
    });
    const reservation = await this.find(id, user);
    if (dto.sendEmail !== false && reservation.guest.email) {
      await this.email(reservation);
    }
    return reservation;
  }

  async sendEmail(id: number, user: JwtPayload) {
    const reservation = await this.find(id, user);
    if (!reservation.depositPaymentId) {
      throw new ConflictException('O sinal desta reserva ainda nao foi confirmado');
    }
    if (!reservation.guest.email) {
      throw new BadRequestException('O hospede nao tem email');
    }
    return this.email(reservation);
  }

  async pdf(id: number, user: JwtPayload) {
    const reservation = await this.find(id, user);
    if (!reservation.depositPaymentId) {
      throw new ConflictException('O sinal desta reserva ainda nao foi confirmado');
    }
    return { buffer: await this.render(reservation), name: `sinal-${reservation.code}` };
  }

  private async email(reservation: DepositReservation) {
    const buffer = await this.render(reservation);
    const content = depositConfirmedEmail(
      reservation.hotel,
      {
        code: reservation.code,
        guestName: `${reservation.guest.firstName} ${reservation.guest.lastName}`,
        roomType: reservation.room.type,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        adults: reservation.adults,
        children: reservation.children,
        totalAmount: reservation.totalAmount,
        depositAmount: reservation.depositAmount,
        depositReference: reservation.depositReference,
      },
      toMoney(reservation.totalAmount).sub(reservation.depositAmount ?? 0),
      mailLang(reservation.locale),
    );
    return this.mail.send({
      hotelId: reservation.hotelId,
      kind: 'DEPOSIT_CONFIRMED',
      to: reservation.guest.email!,
      replyTo: reservation.hotel.email,
      relatedId: reservation.id,
      attachments: [{ filename: `sinal-${reservation.code}.pdf`, content: buffer, contentType: 'application/pdf' }],
      ...content,
    });
  }

  private async find(id: number, user: JwtPayload) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id }, include: depositInclude });
    if (!reservation || !canAccessHotel(user, reservation.hotelId)) {
      throw new NotFoundException('Reserva nao encontrada');
    }
    return reservation;
  }

  async render(reservation: DepositReservation, lang = mailLang(reservation.locale)) {
    const { hotel, guest } = reservation;
    const text = TEXT[lang];
    const logo = hotel.logoFile ? await this.uploads.readForPdf(hotel.logoFile).catch(() => null) : null;
    const timeZone = process.env.AT_TIMEZONE ?? 'Europe/Lisbon';
    const money = (value: { toString(): string } | number) =>
      new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'pt-PT', { style: 'currency', currency: hotel.currency }).format(Number(value.toString()));
    const total = toMoney(reservation.totalAmount);
    const deposit = toMoney(reservation.depositAmount ?? 0);
    const remaining = total.sub(deposit);
    const percent = total.isZero() ? 0 : Number(deposit.div(total).mul(100).toFixed(1));
    const nights = nightsBetween(reservation.checkIn, reservation.checkOut);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: A4.margin, bottom: 20, left: A4.margin, right: A4.margin },
        info: { Title: `${text.title} ${reservation.code}`, Author: hotel.name },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const left = A4.margin;
      const width = doc.page.width - A4.margin * 2;

      const meta = [`${text.number} SN-${reservation.code}`];
      if (reservation.depositConfirmedAt) meta.push(`${text.date}: ${reservation.depositConfirmedAt.toLocaleString(lang === 'en' ? 'en-GB' : 'pt-PT', { timeZone })}`);
      meta.push(`${text.booking} ${text.status[reservation.status].toLowerCase()}`);
      let y = drawHeader(doc, { hotel, logo, title: text.title, meta });

      const half = (width - 14) / 2;
      const guestRows: [string, string][] = [[text.name, `${guest.firstName} ${guest.lastName}`]];
      if (guest.email) guestRows.push([text.email, guest.email]);
      if (guest.phone) guestRows.push([text.phone, guest.phone]);
      if (guest.taxId) guestRows.push([text.taxId, guest.taxId]);
      if (guest.documentNumber) guestRows.push([text.document, [guest.documentType, guest.documentNumber].filter(Boolean).join(' ')]);
      const stayRows: [string, string][] = [
        [text.code, reservation.code],
        [text.room, text.roomValue(reservation.room.type, reservation.room.number)],
        [text.checkIn, day(reservation.checkIn)],
        [text.checkOut, day(reservation.checkOut)],
        [text.nights, String(nights)],
        [text.guests, text.guestsValue(reservation.adults, reservation.children)],
      ];
      y = Math.max(infoCard(doc, left, y, half, text.guest, guestRows), infoCard(doc, left + half + 14, y, half, text.stay, stayRows)) + 18;

      y = sectionTitle(doc, text.amounts, left, y, width);
      const columns: Column[] = [
        { label: text.description, width: width - 230 },
        { label: text.nights, width: 60, align: 'right' },
        { label: text.price, width: 85, align: 'right' },
        { label: text.total, width: 85, align: 'right' },
      ];
      y = tableHeader(doc, left, y, columns);
      y = tableRow(doc, left, y, columns, [text.lodging(reservation.room.type), String(nights), money(reservation.pricePerNight), money(total)], 0);
      y += 14;

      const paymentRows: [string, string][] = [
        [text.method, reservation.depositPaymentType?.name ?? '-'],
        [text.reference, reservation.depositReference ?? '-'],
        [text.confirmedBy, reservation.depositConfirmedBy?.name ?? '-'],
      ];
      const paymentBottom = infoCard(doc, left, y, half, text.payment, paymentRows, 90);
      const totalsBottom = totalsBox(doc, left + width - 240, y, 240, [
        { label: text.bookingTotal, value: money(total) },
        { label: text.received(percent), value: `-${money(deposit)}`, color: COLORS.good },
        { label: text.remaining, value: money(remaining), strong: true },
      ]);
      y = Math.max(paymentBottom, totalsBottom) + 18;

      const message = text.message(money(remaining));
      doc.font('Helvetica').fontSize(8.5);
      const messageHeight = doc.heightOfString(message, { width: width - 24 }) + 18;
      doc.roundedRect(left, y, width, messageHeight, 8).fill(COLORS.soft);
      doc.rect(left, y + 6, 3, messageHeight - 12).fill(COLORS.accent);
      doc.fillColor(COLORS.text).font('Helvetica').fontSize(8.5).text(message, left + 14, y + 9, { width: width - 24 });
      y += messageHeight + 12;
      if (reservation.notes) {
        doc.fillColor(COLORS.muted).fontSize(8).text(`${text.notes}: ${reservation.notes}`, left, y, { width });
        y = doc.y + 8;
      }
      if (hotel.invoiceFooter) {
        doc.fillColor(COLORS.muted).fontSize(8).text(hotel.invoiceFooter, left, y, { width });
      }

      const noticeY = doc.page.height - 52;
      doc.page.margins.bottom = 0;
      doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(7.5).text(text.notice, left, noticeY, { width, align: 'center', lineBreak: false });
      drawFooter(doc, [hotel.name, hotel.phone, hotel.email].filter(Boolean).join(' · '));
      doc.end();
    });
  }
}

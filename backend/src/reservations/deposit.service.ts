import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReservationStatus } from '@prisma/client';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import PDFDocument from 'pdfkit';
import { JwtPayload } from '../auth/jwt-payload';
import { FolioService } from '../billing/folio.service';
import { nightsBetween } from '../common/dates';
import { canAccessHotel } from '../common/hotel-scope';
import { toMoney } from '../common/money';
import { MailService } from '../mail/mail.service';
import { depositConfirmedEmail } from '../mail/templates';
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

const STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmada',
  CHECKED_IN: 'Em casa',
  CHECKED_OUT: 'Terminada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No-show',
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

  async render(reservation: DepositReservation) {
    const { hotel, guest } = reservation;
    const logo = hotel.logoFile ? await this.uploads.read(hotel.logoFile).then((file) => file.bytes).catch(() => null) : null;
    const timeZone = process.env.AT_TIMEZONE ?? 'Europe/Lisbon';
    const money = (value: { toString(): string } | number) =>
      new Intl.NumberFormat('pt-PT', { style: 'currency', currency: hotel.currency }).format(Number(value.toString()));
    const total = toMoney(reservation.totalAmount);
    const deposit = toMoney(reservation.depositAmount ?? 0);
    const remaining = total.sub(deposit);
    const percent = total.isZero() ? 0 : Number(deposit.div(total).mul(100).toFixed(1));
    const nights = nightsBetween(reservation.checkIn, reservation.checkOut);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Comprovativo de sinal ${reservation.code}`, Author: hotel.name } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const left = 50;
      const width = doc.page.width - 100;
      const accent = '#4338ca';

      let textX = left;
      if (logo) {
        try {
          doc.image(logo, left, 45, { fit: [120, 70] });
          textX = left + 135;
        } catch {
          textX = left;
        }
      }
      doc.fillColor('#0f172a').fontSize(15).font('Helvetica-Bold').text(hotel.name, textX, 48, { width: 260 });
      doc.fontSize(8.5).font('Helvetica').fillColor('#334155');
      if (hotel.legalName && hotel.legalName !== hotel.name) doc.text(hotel.legalName, textX, doc.y, { width: 260 });
      if (hotel.taxId) doc.text(`NIF: ${hotel.taxId}`, textX, doc.y, { width: 260 });
      const place = [hotel.address, [hotel.postalCode, hotel.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      if (place) doc.text(place, textX, doc.y, { width: 260 });
      const contacts = [hotel.phone, hotel.email].filter(Boolean).join(' · ');
      if (contacts) doc.text(contacts, textX, doc.y, { width: 260 });
      const headerBottom = Math.max(doc.y, logo ? 118 : doc.y);

      doc.fillColor(accent).fontSize(14).font('Helvetica-Bold').text('COMPROVATIVO DE SINAL', left, 48, { width, align: 'right' });
      doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
      doc.text(`N.o SN-${reservation.code}`, { width, align: 'right' });
      if (reservation.depositConfirmedAt) {
        doc.text(`Data: ${reservation.depositConfirmedAt.toLocaleString('pt-PT', { timeZone })}`, { width, align: 'right' });
      }
      doc.text(`Reserva ${STATUS_LABELS[reservation.status].toLowerCase()}`, { width, align: 'right' });

      let y = Math.max(headerBottom, doc.y) + 18;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1.5).stroke(accent);
      y += 16;

      const box = (title: string, x: number, top: number, boxWidth: number, rows: [string, string][]) => {
        doc.fillColor(accent).fontSize(9).font('Helvetica-Bold').text(title.toUpperCase(), x, top, { width: boxWidth });
        let rowY = top + 16;
        for (const [label, value] of rows) {
          doc.fillColor('#64748b').fontSize(8.5).font('Helvetica').text(label, x, rowY, { width: 95 });
          doc.fillColor('#0f172a').font('Helvetica').text(value, x + 95, rowY, { width: boxWidth - 95 });
          rowY = Math.max(doc.y, rowY + 12) + 3;
        }
        return rowY;
      };

      const half = (width - 20) / 2;
      const guestRows: [string, string][] = [['Nome', `${guest.firstName} ${guest.lastName}`]];
      if (guest.email) guestRows.push(['Email', guest.email]);
      if (guest.phone) guestRows.push(['Telefone', guest.phone]);
      if (guest.taxId) guestRows.push(['NIF', guest.taxId]);
      if (guest.documentNumber) guestRows.push(['Documento', [guest.documentType, guest.documentNumber].filter(Boolean).join(' ')]);
      const stayRows: [string, string][] = [
        ['Codigo', reservation.code],
        ['Quarto', `${reservation.room.type} (n.o ${reservation.room.number})`],
        ['Entrada', day(reservation.checkIn)],
        ['Saida', day(reservation.checkOut)],
        ['Noites', String(nights)],
        ['Hospedes', `${reservation.adults} adulto(s)${reservation.children ? `, ${reservation.children} crianca(s)` : ''}`],
      ];
      y = Math.max(box('Hospede', left, y, half, guestRows), box('Estadia', left + half + 20, y, half, stayRows)) + 14;

      doc.fillColor(accent).fontSize(9).font('Helvetica-Bold').text('VALORES', left, y);
      y += 16;
      const columns = [
        { label: 'Descricao', x: left, w: 260, align: 'left' as const },
        { label: 'Qtd', x: left + 260, w: 60, align: 'right' as const },
        { label: 'Preco', x: left + 320, w: 85, align: 'right' as const },
        { label: 'Total', x: left + 405, w: width - 405, align: 'right' as const },
      ];
      doc.rect(left, y - 4, width, 18).fill('#eef2ff');
      doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica-Bold');
      for (const column of columns) doc.text(column.label, column.x + 4, y, { width: column.w - 8, align: column.align });
      y += 20;
      doc.font('Helvetica');
      const values = [`Alojamento ${reservation.room.type}`, String(nights), money(reservation.pricePerNight), money(total)];
      columns.forEach((column, index) => doc.text(values[index], column.x + 4, y, { width: column.w - 8, align: column.align }));
      y += 22;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).stroke('#cbd5e1');
      y += 10;

      const totalsX = left + width - 230;
      const totalLine = (label: string, value: string, options: { bold?: boolean; color?: string; size?: number } = {}) => {
        doc.fillColor(options.color ?? '#0f172a').fontSize(options.size ?? 9.5).font(options.bold ? 'Helvetica-Bold' : 'Helvetica');
        doc.text(label, totalsX, y, { width: 130 });
        doc.text(value, totalsX + 130, y, { width: 100, align: 'right' });
        y += (options.size ?? 9.5) + 8;
      };
      totalLine('Total da reserva', money(total));
      totalLine(`Sinal recebido (${percent}%)`, `-${money(deposit)}`, { bold: true, color: '#047857', size: 11 });
      doc.moveTo(totalsX, y - 3).lineTo(left + width, y - 3).lineWidth(0.5).stroke('#cbd5e1');
      y += 4;
      totalLine('Restante a pagar', money(remaining), { bold: true, size: 12 });

      y += 10;
      doc.fillColor(accent).fontSize(9).font('Helvetica-Bold').text('PAGAMENTO DO SINAL', left, y);
      y += 16;
      const paymentRows: [string, string][] = [
        ['Forma de pagamento', reservation.depositPaymentType?.name ?? '-'],
        ['Referencia', reservation.depositReference ?? '-'],
        ['Confirmado por', reservation.depositConfirmedBy?.name ?? '-'],
      ];
      for (const [label, value] of paymentRows) {
        doc.fillColor('#64748b').fontSize(8.5).font('Helvetica').text(label, left, y, { width: 120 });
        doc.fillColor('#0f172a').text(value, left + 120, y, { width: width - 120 });
        y = Math.max(doc.y, y + 12) + 3;
      }

      y += 12;
      doc.roundedRect(left, y, width, 46, 4).fill('#f8fafc');
      doc.fillColor('#334155').fontSize(8.5).font('Helvetica').text(
        `O valor restante de ${money(remaining)} sera cobrado no check-in ou no check-out, juntamente com os consumos da estadia. A fatura e emitida no check-out e inclui o valor deste sinal.`,
        left + 10,
        y + 9,
        { width: width - 20 },
      );
      y += 58;
      if (reservation.notes) {
        doc.fillColor('#64748b').fontSize(8).text(`Observacoes: ${reservation.notes}`, left, y, { width });
        y = doc.y + 8;
      }
      if (hotel.invoiceFooter) {
        doc.fillColor('#64748b').fontSize(8).text(hotel.invoiceFooter, left, y, { width });
      }

      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - 70;
      doc.moveTo(left, footerY).lineTo(left + width, footerY).lineWidth(0.5).stroke('#cbd5e1');
      doc.fillColor('#64748b').fontSize(7.5).font('Helvetica');
      doc.text('Documento interno, sem valor fiscal. Nao substitui a fatura.', left, footerY + 8, { width, align: 'center', lineBreak: false });
      doc.text([hotel.name, hotel.phone, hotel.email].filter(Boolean).join(' · '), left, footerY + 20, { width, align: 'center', lineBreak: false });
      doc.end();
    });
  }
}

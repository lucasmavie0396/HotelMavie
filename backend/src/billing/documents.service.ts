import { Injectable, NotFoundException } from '@nestjs/common';
import { ChargeType, InvoiceType } from '@prisma/client';
import { printedHash } from '../at/at-format';
import { AtSigningService } from '../at/at-signing.service';
import { JwtPayload } from '../auth/jwt-payload';
import { nightsBetween } from '../common/dates';
import { canAccessHotel } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { FolioService } from './folio.service';
import { Ticket } from './ticket-pdf.service';

const DOC_TITLES: Record<InvoiceType, string> = {
  INVOICE: 'FATURA',
  INVOICE_RECEIPT: 'FATURA-RECIBO',
  CREDIT_NOTE: 'NOTA DE CREDITO',
  RECEIPT: 'RECIBO',
};

const CHARGE_LABELS: Record<ChargeType, string> = {
  ACCOMMODATION: 'Alojamento',
  RESTAURANT: 'Restaurante',
  BAR: 'Bar',
  EXTRA: 'Extras',
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Numerario',
  CARD: 'Cartao',
  TRANSFER: 'Transferencia',
  MOBILE: 'Pagamento movel',
  OTHER: 'Outro',
};

export function paymentLabel(payment: { method: string; paymentType?: { name: string } | null }) {
  return payment.paymentType?.name ?? METHOD_LABELS[payment.method] ?? payment.method;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folio: FolioService,
    private readonly signing: AtSigningService,
  ) {}

  async invoice(id: number, user: JwtPayload) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        hotel: true,
        lines: true,
        creditOf: { select: { fullNumber: true } },
        createdBy: { select: { name: true } },
        payments: { include: { paymentType: { select: { name: true } } } },
      },
    });
    if (!invoice || !canAccessHotel(user, invoice.hotelId)) {
      throw new NotFoundException('Documento nao encontrado');
    }
    const ticket = new Ticket(invoice.currency).header(invoice.hotel);
    ticket.text(`${DOC_TITLES[invoice.type]} ${invoice.fullNumber}`, { bold: true, align: 'center' });
    ticket.text(Ticket.when(invoice.issuedAt), { align: 'center', size: 8 });
    ticket.text(`ATCUD: ${invoice.atcud ?? '0'}`, { align: 'center', size: 8 });
    if (invoice.creditOf) ticket.text(`Referente a ${invoice.creditOf.fullNumber}: ${invoice.reason ?? ''}`, { align: 'center', size: 8 });
    ticket.rule();
    ticket.text(`Cliente: ${invoice.customerName}`, { size: 8 });
    ticket.text(`NIF: ${invoice.customerTaxId ?? 'Consumidor final'}`, { size: 8 });
    if (invoice.customerAddress) ticket.text(invoice.customerAddress, { size: 8 });
    ticket.rule();
    ticket.lines(
      invoice.lines.map((line) => ({
        quantity: line.quantity,
        description: `${line.description} (${Number(line.taxRate)}%)`,
        unitPrice: line.unitPrice,
        total: line.grossAmount,
      })),
    );
    ticket.rule();
    const rates = new Map<string, { base: number; tax: number; reason: string | null }>();
    for (const line of invoice.lines) {
      const key = `${Number(line.taxRate)}%`;
      const current = rates.get(key) ?? { base: 0, tax: 0, reason: line.exemptionReason };
      current.base += Number(line.netAmount);
      current.tax += Number(line.taxAmount);
      rates.set(key, current);
    }
    for (const [rate, values] of rates) {
      ticket.cols(`IVA ${rate} s/ ${ticket.money(values.base)}`, ticket.money(values.tax), { size: 8 });
      if (values.reason) ticket.text(`  Isencao: ${values.reason}`, { size: 7 });
    }
    ticket.cols('Total sem IVA', ticket.money(invoice.netTotal), { size: 8 });
    ticket.cols('TOTAL', ticket.money(invoice.grossTotal), { bold: true, size: 13 });
    if (invoice.payments.length) {
      ticket.rule();
      for (const payment of invoice.payments) {
        ticket.cols(`Pago: ${paymentLabel(payment)}${payment.reference ? ` (${payment.reference})` : ''}`, ticket.money(payment.amount), { size: 8 });
      }
    }
    ticket.space();
    ticket.text(this.certification(printedHash(invoice.hash)), { size: 7, align: 'center' });
    if (invoice.type === InvoiceType.INVOICE) ticket.text('Este documento nao serve de recibo.', { size: 7, align: 'center' });
    ticket.footer(invoice.hotel, invoice.createdBy?.name);
    return { ticket, hotelId: invoice.hotelId };
  }

  async receipt(id: number, user: JwtPayload) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      include: {
        hotel: true,
        lines: { include: { invoice: { select: { fullNumber: true, issuedAt: true, grossTotal: true } } } },
        paymentType: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!receipt || !canAccessHotel(user, receipt.hotelId)) {
      throw new NotFoundException('Recibo nao encontrado');
    }
    const ticket = new Ticket(receipt.hotel.currency).header(receipt.hotel);
    ticket.text(`RECIBO ${receipt.fullNumber}`, { bold: true, align: 'center' });
    ticket.text(Ticket.when(receipt.issuedAt), { align: 'center', size: 8 });
    ticket.text(`ATCUD: ${receipt.atcud ?? '0'}`, { align: 'center', size: 8 });
    if (receipt.status === 'CANCELLED') ticket.text(`ANULADO: ${receipt.cancelReason ?? ''}`, { bold: true, align: 'center' });
    ticket.rule();
    ticket.text(`Cliente: ${receipt.customerName}`, { size: 8 });
    ticket.text(`NIF: ${receipt.customerTaxId ?? 'Consumidor final'}`, { size: 8 });
    ticket.rule();
    for (const line of receipt.lines) {
      ticket.cols(`${line.invoice.fullNumber} de ${Ticket.day(line.invoice.issuedAt)}`, ticket.money(line.amount), { size: 9 });
      ticket.text(`   valor do documento ${ticket.money(line.invoice.grossTotal)}`, { size: 7 });
    }
    ticket.rule();
    ticket.cols(`Pago: ${paymentLabel(receipt)}${receipt.reference ? ` (${receipt.reference})` : ''}`, '', { size: 8 });
    ticket.cols('TOTAL RECEBIDO', ticket.money(receipt.amount), { bold: true, size: 13 });
    ticket.space();
    ticket.text(this.certification(), { size: 7, align: 'center' });
    ticket.footer(receipt.hotel, receipt.createdBy?.name);
    return { ticket, hotelId: receipt.hotelId };
  }

  async statement(reservationId: number, user: JwtPayload) {
    const folio = await this.folio.getFolio(reservationId, user);
    const reservation = await this.prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
      include: { guest: true, room: true, hotel: true },
    });
    const payments = await this.prisma.payment.findMany({
      where: { reservationId },
      include: { paymentType: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const operator = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } });
    const ticket = new Ticket(reservation.hotel.currency).header(reservation.hotel);
    ticket.text(`CONTA DO QUARTO ${reservation.room.number}`, { bold: true, size: 12, align: 'center' });
    ticket.text(`Emitida em ${Ticket.when(new Date())}`, { align: 'center', size: 8 });
    ticket.rule();
    ticket.text(`${reservation.guest.firstName} ${reservation.guest.lastName}`, { bold: true });
    if (reservation.guest.taxId) ticket.text(`NIF: ${reservation.guest.taxId}`, { size: 8 });
    ticket.cols('Reserva', reservation.code, { size: 8 });
    ticket.cols('Entrada / saida', `${Ticket.day(reservation.checkIn)} - ${Ticket.day(reservation.checkOut)}`, { size: 8 });
    ticket.cols('Noites / pessoas', `${nightsBetween(reservation.checkIn, reservation.checkOut)} / ${reservation.adults + reservation.children}`, { size: 8 });
    if (reservation.depositPaymentId && reservation.depositAmount) {
      ticket.cols('Sinal pago na reserva', ticket.money(reservation.depositAmount), { size: 8 });
    }
    ticket.rule();

    const byType = new Map<ChargeType, number>();
    for (const charge of folio.charges) {
      ticket.cols(`${Ticket.day(charge.createdAt).slice(0, 5)} ${Number(charge.quantity)} x ${charge.description}`, ticket.money(charge.total), { size: 8 });
      if (Number(charge.quantity) !== 1) ticket.text(`   ${Number(charge.quantity)} x ${ticket.money(charge.unitPrice)}`, { size: 7 });
      if (charge.invoice) ticket.text(`   ${charge.onCustomerAccount ? 'faturado a pagar' : 'faturado'}: ${charge.invoice.fullNumber}`, { size: 7 });
      byType.set(charge.type, (byType.get(charge.type) ?? 0) + Number(charge.total));
    }
    ticket.rule();
    for (const [type, total] of byType) ticket.cols(CHARGE_LABELS[type], ticket.money(total), { size: 8 });
    ticket.cols('Total de consumos', ticket.money([...byType.values()].reduce((sum, value) => sum + value, 0)), { bold: true, size: 9 });
    if (payments.length) {
      ticket.rule();
      for (const payment of payments) {
        const label = `${payment.id === reservation.depositPaymentId ? 'Sinal ' : ''}${paymentLabel(payment)}`;
        ticket.cols(`${Ticket.day(payment.createdAt).slice(0, 5)} ${label}${payment.reference ? ` (${payment.reference})` : ''}`, `-${ticket.money(payment.amount)}`, { size: 8 });
      }
      ticket.cols('Total pago', `-${ticket.money(folio.paymentsTotal)}`, { size: 9 });
    }
    if (Number(folio.customerAccountTotal) > 0) {
      ticket.cols('Faturado a pagar (conta corrente)', `-${ticket.money(folio.customerAccountTotal)}`, { size: 8 });
    }
    ticket.rule();
    ticket.cols('SALDO A PAGAR', ticket.money(folio.balance), { bold: true, size: 13 });
    if (folio.invoices.length) {
      ticket.space();
      ticket.text(`Documentos emitidos: ${folio.invoices.map((invoice) => invoice.fullNumber).join(', ')}`, { size: 7 });
    }
    ticket.space();
    ticket.text('Documento de consulta. Nao serve de fatura.', { size: 7, align: 'center' });
    ticket.footer(reservation.hotel, operator?.name);
    return { ticket, hotelId: reservation.hotelId };
  }

  async payment(id: number, user: JwtPayload) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        hotel: true,
        paymentType: { select: { name: true } },
        reservation: { select: { id: true, code: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } } },
        invoice: { select: { fullNumber: true } },
        receipt: { select: { fullNumber: true } },
        order: { select: { tableLabel: true, id: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!payment || !canAccessHotel(user, payment.hotelId)) {
      throw new NotFoundException('Pagamento nao encontrado');
    }
    const ticket = new Ticket(payment.hotel.currency).header(payment.hotel);
    ticket.text(Number(payment.amount) < 0 ? 'COMPROVATIVO DE DEVOLUCAO' : 'COMPROVATIVO DE PAGAMENTO', { bold: true, align: 'center' });
    ticket.text(`N.o ${payment.id} · ${Ticket.when(payment.createdAt)}`, { align: 'center', size: 8 });
    ticket.rule();
    if (payment.reservation) {
      ticket.cols('Quarto', payment.reservation.room.number, { size: 9 });
      ticket.cols('Hospede', `${payment.reservation.guest.firstName} ${payment.reservation.guest.lastName}`, { size: 9 });
      ticket.cols('Reserva', payment.reservation.code, { size: 9 });
    }
    if (payment.order) ticket.cols('Mesa', payment.order.tableLabel ?? `#${payment.order.id}`, { size: 9 });
    ticket.cols('Tipo de pagamento', paymentLabel(payment), { size: 9 });
    if (payment.reference) ticket.cols('Referencia', payment.reference, { size: 9 });
    ticket.rule();
    ticket.cols('VALOR', ticket.money(payment.amount), { bold: true, size: 13 });
    if (payment.reservation) {
      const balance = await this.folio.balance(this.prisma, payment.reservation.id);
      ticket.cols('Saldo em divida da estadia', ticket.money(balance), { size: 8 });
    }
    ticket.space();
    const document = payment.invoice?.fullNumber ?? payment.receipt?.fullNumber;
    ticket.text(document ? `Documento fiscal: ${document}` : 'Comprovativo interno. Nao serve de fatura nem de recibo.', { size: 7, align: 'center' });
    ticket.footer(payment.hotel, payment.createdBy?.name);
    return { ticket, hotelId: payment.hotelId };
  }

  private certification(hash?: string) {
    const prefix = hash ? `${hash}-` : '';
    return this.signing.certified
      ? `${prefix}Processado por programa certificado n.o ${this.signing.certificateNumber}/AT`
      : `${prefix}Software nao certificado pela AT. Sem validade fiscal.`;
  }
}

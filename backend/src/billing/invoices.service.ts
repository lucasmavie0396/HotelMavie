import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Charge, InvoiceStatus, InvoiceType, Prisma, TaxCategory, TaxRate } from '@prisma/client';
import { DOC_TYPE, localParts, signatureMessage } from '../at/at-format';
import { AtSigningService } from '../at/at-signing.service';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { addDays, parseDate } from '../common/dates';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { splitGross, sumMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { CreditNoteDto, InvoiceQueryDto, IssueInvoiceDto } from './billing.dto';

export interface CustomerData {
  customerName?: string;
  customerTaxId?: string;
  customerAddress?: string;
  customerEmail?: string;
}

export interface IssueInput extends CustomerData {
  hotelId: number;
  type: InvoiceType;
  reservationId?: number | null;
  charges: (Charge & { taxRateRef: TaxRate | null })[];
  createdById?: number;
}

export const invoiceInclude = {
  lines: true,
  creditOf: { select: { id: true, fullNumber: true } },
  creditNotes: { select: { id: true, fullNumber: true } },
} satisfies Prisma.InvoiceInclude;

export function seriesCode(date: Date) {
  return String(localParts(date).year);
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: AtSigningService,
    private readonly audit: AuditService,
  ) {}

  async ensureSeries(hotelId: number, ...types: InvoiceType[]) {
    const code = seriesCode(new Date());
    for (const type of types) {
      await this.prisma.$executeRaw`INSERT IGNORE INTO invoice_series (hotelId, type, code, nextNumber, active, createdAt) VALUES (${hotelId}, ${type}, ${code}, 1, true, NOW(3))`;
    }
  }

  findAll(query: InvoiceQueryDto, user: JwtPayload) {
    const q = query.q?.trim();
    return this.prisma.invoice.findMany({
      where: {
        hotelId: resolveHotelScope(user, query.hotelId),
        type: query.type,
        issuedAt: {
          ...(query.from ? { gte: parseDate(query.from) } : {}),
          ...(query.to ? { lt: addDays(parseDate(query.to), 1) } : {}),
        },
        ...(q ? { OR: [{ fullNumber: { contains: q } }, { customerName: { contains: q } }, { customerTaxId: { contains: q } }] } : {}),
      },
      orderBy: { issuedAt: 'desc' },
      take: 500,
    });
  }

  async findOne(id: number, user: JwtPayload) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
    if (!invoice || !canAccessHotel(user, invoice.hotelId)) {
      throw new NotFoundException('Documento nao encontrado');
    }
    return invoice;
  }

  async issueForReservation(reservationId: number, dto: IssueInvoiceDto, user: JwtPayload) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id: reservationId }, include: { guest: true } });
    if (!reservation || !canAccessHotel(user, reservation.hotelId)) {
      throw new NotFoundException('Reserva nao encontrada');
    }
    const type = dto.type ?? InvoiceType.INVOICE;
    await this.ensureSeries(reservation.hotelId, type);
    return this.prisma.$transaction(async (tx) => {
      const charges = await tx.charge.findMany({
        where: {
          reservationId,
          invoiceId: null,
          ...(dto.chargeIds ? { id: { in: dto.chargeIds } } : {}),
        },
        include: { taxRateRef: true },
      });
      if (dto.chargeIds && charges.length !== dto.chargeIds.length) {
        throw new ConflictException('Alguns lancamentos nao existem ou ja foram faturados');
      }
      const guest = reservation.guest;
      return this.issue(tx, {
        hotelId: reservation.hotelId,
        type,
        reservationId,
        charges,
        customerName: dto.customerName ?? `${guest.firstName} ${guest.lastName}`,
        customerTaxId: dto.customerTaxId ?? guest.taxId ?? undefined,
        customerAddress: dto.customerAddress ?? guest.address ?? undefined,
        customerEmail: dto.customerEmail ?? guest.email ?? undefined,
        createdById: user.sub,
      });
    });
  }

  async issue(tx: Prisma.TransactionClient, input: IssueInput) {
    if (!input.charges.length) {
      throw new BadRequestException('Nao ha lancamentos por faturar');
    }
    const untaxed = input.charges.filter((charge) => !charge.taxRateRef);
    if (untaxed.length) {
      throw new BadRequestException(
        `Lancamentos sem taxa de IVA: ${untaxed.map((c) => c.description).join(', ')}. Configura a taxa (ou a isencao) antes de faturar.`,
      );
    }
    const lines = input.charges.map((charge) => {
      const { netAmount, taxAmount, grossAmount } = splitGross(charge.total, charge.taxRate);
      const exempt = charge.taxRate.isZero();
      return {
        description: charge.description,
        productCode: charge.productCode ?? charge.type,
        quantity: charge.quantity,
        unitPrice: charge.unitPrice,
        taxRate: charge.taxRate,
        taxCategory: exempt ? TaxCategory.ISE : charge.taxRateRef!.atCategory,
        exemptionReason: exempt ? charge.taxRateRef!.exemptionReason : null,
        exemptionCode: exempt ? charge.taxRateRef!.exemptionCode : null,
        netAmount,
        taxAmount,
        grossAmount,
      };
    });
    if (sumMoney(lines.map((line) => line.grossAmount)).isNegative()) {
      throw new BadRequestException('O total do documento nao pode ser negativo');
    }
    const invoice = await this.createDocument(tx, {
      hotelId: input.hotelId,
      type: input.type,
      reservationId: input.reservationId,
      customer: input,
      lines,
      createdById: input.createdById,
    });
    await tx.charge.updateMany({
      where: { id: { in: input.charges.map((charge) => charge.id) } },
      data: { invoiceId: invoice.id },
    });
    return invoice;
  }

  async creditNote(id: number, dto: CreditNoteDto, user: JwtPayload) {
    const original = await this.findOne(id, user);
    if (original.type === InvoiceType.CREDIT_NOTE) {
      throw new BadRequestException('Nao e possivel creditar uma nota de credito');
    }
    const receipts = await this.prisma.receiptLine.count({ where: { invoiceId: id, receipt: { status: 'ISSUED' } } });
    if (receipts) {
      throw new ConflictException('Esta fatura tem recibos emitidos: anula-os antes de emitir a nota de credito');
    }
    await this.ensureSeries(original.hotelId, InvoiceType.CREDIT_NOTE);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.invoice.updateMany({
        where: { id, status: InvoiceStatus.ISSUED },
        data: { status: InvoiceStatus.CREDITED },
      });
      if (!count) {
        throw new ConflictException('Este documento ja foi creditado');
      }
      const note = await this.createDocument(tx, {
        hotelId: original.hotelId,
        type: InvoiceType.CREDIT_NOTE,
        reservationId: original.reservationId,
        creditOfId: original.id,
        reason: dto.reason,
        customer: original,
        lines: original.lines.map(({ id: _id, invoiceId: _invoiceId, ...line }) => line),
        createdById: user.sub,
      });
      await tx.charge.updateMany({ where: { invoiceId: original.id }, data: { invoiceId: null } });
      await this.audit.log(
        {
          hotelId: original.hotelId,
          userId: user.sub,
          action: 'CREDIT_NOTE',
          entity: 'invoice',
          entityId: note.id,
          summary: `${note.fullNumber} credita ${original.fullNumber} (${original.grossTotal.toFixed(2)}): ${dto.reason}`,
          data: { originalId: original.id, original: original.fullNumber, total: original.grossTotal.toFixed(2), reason: dto.reason },
        },
        tx,
      );
      return note;
    });
  }

  private async createDocument(
    tx: Prisma.TransactionClient,
    input: {
      hotelId: number;
      type: InvoiceType;
      reservationId?: number | null;
      creditOfId?: number;
      reason?: string;
      customer: CustomerData | { customerName: string; customerTaxId: string | null; customerAddress: string | null; customerEmail: string | null };
      lines: Omit<Prisma.InvoiceLineCreateManyInvoiceInput, 'invoiceId'>[];
      createdById?: number;
    },
  ) {
    const hotel = await tx.hotel.findUniqueOrThrow({ where: { id: input.hotelId } });
    const issuedAt = new Date();
    const code = seriesCode(issuedAt);
    const [series] = await tx.$queryRaw<
      { id: number; code: string; nextNumber: number; lastHash: string | null; atValidationCode: string | null }[]
    >`SELECT id, code, nextNumber, lastHash, atValidationCode FROM invoice_series
      WHERE hotelId = ${input.hotelId} AND type = ${input.type} AND code = ${code} FOR UPDATE`;
    if (!series) {
      throw new ConflictException('Serie de faturacao indisponivel, tenta novamente');
    }

    const netTotal = sumMoney(input.lines.map((line) => line.netAmount as Prisma.Decimal));
    const taxTotal = sumMoney(input.lines.map((line) => line.taxAmount as Prisma.Decimal));
    const grossTotal = sumMoney(input.lines.map((line) => line.grossAmount as Prisma.Decimal));
    const number = Number(series.nextNumber);
    const fullNumber = `${DOC_TYPE[input.type]} ${series.code}/${number}`;
    const hash = this.signing.sign(signatureMessage({ issuedAt, invoiceNo: fullNumber, grossTotal, previousHash: series.lastHash }));
    const atcud = series.atValidationCode ? `${series.atValidationCode}-${number}` : null;

    const invoice = await tx.invoice.create({
      data: {
        hotelId: input.hotelId,
        seriesId: series.id,
        type: input.type,
        number,
        fullNumber,
        issuedAt,
        reservationId: input.reservationId ?? null,
        creditOfId: input.creditOfId,
        reason: input.reason,
        customerName: input.customer.customerName || 'Consumidor final',
        customerTaxId: input.customer.customerTaxId || null,
        customerAddress: input.customer.customerAddress || null,
        customerEmail: input.customer.customerEmail || null,
        currency: hotel.currency,
        netTotal,
        taxTotal,
        grossTotal,
        previousHash: series.lastHash,
        hash,
        atcud,
        keyVersion: this.signing.keyVersion,
        createdById: input.createdById,
        lines: { createMany: { data: input.lines } },
      },
      include: invoiceInclude,
    });
    await tx.invoiceSeries.update({
      where: { id: series.id },
      data: { nextNumber: number + 1, lastHash: hash },
    });
    return invoice;
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Charge, ChargeType, InvoiceStatus, InvoiceType, Prisma, ReceiptStatus, TaxCategory, TaxRate } from '@prisma/client';
import { DOC_TYPE, localParts, signatureMessage } from '../at/at-format';
import { AtSigningService } from '../at/at-signing.service';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { addDays, parseDate } from '../common/dates';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { splitGross, sumMoney, toMoney } from '../common/money';
import { forUpdate, lockHint } from '../prisma/database';
import { PrismaService } from '../prisma/prisma.service';
import { CreditNoteDto, InvoiceQueryDto, IssueInvoiceDto } from './billing.dto';
import { requireOpenCash } from './cash-guard';
import { chargeData, resolveLines } from './document-lines';
import { CreateManualInvoiceDto } from './documents.dto';

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
  dueDate?: Date | null;
  notes?: string | null;
}

export function openAmount(invoice: {
  type: InvoiceType;
  status: InvoiceStatus;
  grossTotal: Prisma.Decimal;
  receiptLines: { amount: Prisma.Decimal }[];
  creditNotes: { grossTotal: Prisma.Decimal }[];
}) {
  if (invoice.type !== InvoiceType.INVOICE || invoice.status !== InvoiceStatus.ISSUED) return new Prisma.Decimal(0);
  const open = toMoney(invoice.grossTotal)
    .sub(sumMoney(invoice.receiptLines.map((line) => line.amount)))
    .sub(sumMoney(invoice.creditNotes.map((note) => note.grossTotal)));
  return open.isNegative() ? new Prisma.Decimal(0) : open;
}

const openInclude = {
  receiptLines: { where: { receipt: { status: ReceiptStatus.ISSUED } }, select: { amount: true } },
  creditNotes: { select: { grossTotal: true } },
} satisfies Prisma.InvoiceInclude;

export const invoiceInclude = {
  lines: true,
  creditOf: { select: { id: true, fullNumber: true } },
  creditNotes: { select: { id: true, fullNumber: true } },
} satisfies Prisma.InvoiceInclude;

export async function createSeriesIfMissing(client: Prisma.TransactionClient, hotelId: number, type: InvoiceType, code: string) {
  if (await client.invoiceSeries.findUnique({ where: { hotelId_type_code: { hotelId, type, code } }, select: { id: true } })) return;
  try {
    await client.invoiceSeries.create({ data: { hotelId, type, code } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
  }
}

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
      await createSeriesIfMissing(this.prisma, hotelId, type, code);
    }
  }

  async findAll(query: InvoiceQueryDto, user: JwtPayload) {
    const q = query.q?.trim();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        hotelId: resolveHotelScope(user, query.hotelId),
        ...(query.unpaid
          ? { type: InvoiceType.INVOICE, status: InvoiceStatus.ISSUED }
          : {
              type: query.type,
              status: query.status,
              issuedAt: {
                ...(query.from ? { gte: parseDate(query.from) } : {}),
                ...(query.to ? { lt: addDays(parseDate(query.to), 1) } : {}),
              },
            }),
        ...(q ? { OR: [{ fullNumber: { contains: q } }, { customerName: { contains: q } }, { customerTaxId: { contains: q } }] } : {}),
      },
      include: { ...openInclude, quote: { select: { id: true, fullNumber: true } }, creditOf: { select: { id: true, fullNumber: true } } },
      orderBy: { issuedAt: 'desc' },
      take: 500,
    });
    const rows = invoices.map(({ receiptLines, creditNotes, ...invoice }) => ({
      ...invoice,
      open: openAmount({ ...invoice, receiptLines, creditNotes }),
      credited: sumMoney(creditNotes.map((note) => note.grossTotal)),
    }));
    return query.unpaid ? rows.filter((row) => row.open.greaterThan(0)) : rows;
  }

  async detail(id: number, user: JwtPayload) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        lines: { include: { creditLines: { select: { quantity: true } } }, orderBy: { id: 'asc' } },
        creditOf: { select: { id: true, fullNumber: true } },
        creditNotes: { select: { id: true, fullNumber: true, grossTotal: true, issuedAt: true, reason: true } },
        receiptLines: { include: { receipt: { select: { id: true, fullNumber: true, issuedAt: true, status: true } } } },
        quote: { select: { id: true, fullNumber: true } },
        reservation: { select: { id: true, code: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!invoice || !canAccessHotel(user, invoice.hotelId)) {
      throw new NotFoundException('Documento nao encontrado');
    }
    const { lines, receiptLines, ...rest } = invoice;
    return {
      ...rest,
      lines: lines.map(({ creditLines, ...line }) => ({ ...line, creditedQuantity: creditLines.reduce((sum, credit) => sum.add(credit.quantity), new Prisma.Decimal(0)) })),
      receipts: receiptLines.map((line) => ({ ...line.receipt, amount: line.amount })),
      open: openAmount({ ...invoice, receiptLines: receiptLines.filter((line) => line.receipt.status === ReceiptStatus.ISSUED) }),
    };
  }

  async issueManual(dto: CreateManualInvoiceDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, dto.hotelId);
    if (!hotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    const customerName = dto.customerName?.trim();
    if (!customerName) {
      throw new BadRequestException('Indique o cliente: a fatura fica a credito na conta dele');
    }
    await requireOpenCash(this.prisma, hotelId, user.sub);
    const lines = await resolveLines(this.prisma, hotelId, dto.lines);
    await this.ensureSeries(hotelId, InvoiceType.INVOICE);
    return this.prisma.$transaction(async (tx) => {
      const invoice = await this.issueLines(tx, {
        hotelId,
        lines,
        customer: { ...dto, customerName },
        dueDate: dto.dueDate ? parseDate(dto.dueDate) : null,
        notes: dto.notes?.trim() || null,
        createdById: user.sub,
      });
      await this.audit.log(
        {
          hotelId,
          userId: user.sub,
          action: 'INVOICE_MANUAL',
          entity: 'invoice',
          entityId: invoice.id,
          summary: `${invoice.fullNumber} emitida a credito para ${invoice.customerName} (${invoice.grossTotal.toFixed(2)})`,
          data: { total: invoice.grossTotal.toFixed(2), lines: lines.length },
        },
        tx,
      );
      return invoice;
    });
  }

  async issueLines(
    tx: Prisma.TransactionClient,
    input: {
      hotelId: number;
      lines: Parameters<typeof chargeData>[0][];
      customer: CustomerData;
      dueDate?: Date | null;
      notes?: string | null;
      createdById: number;
    },
  ) {
    const charges = [];
    for (const line of input.lines) {
      const charge = await tx.charge.create({
        data: { hotelId: input.hotelId, type: ChargeType.EXTRA, createdById: input.createdById, ...chargeData(line) },
        include: { taxRateRef: true },
      });
      charges.push(charge);
    }
    return this.issue(tx, {
      hotelId: input.hotelId,
      type: InvoiceType.INVOICE,
      charges,
      ...input.customer,
      dueDate: input.dueDate,
      notes: input.notes,
      createdById: input.createdById,
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
    await requireOpenCash(this.prisma, reservation.hotelId, user.sub);
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
      dueDate: input.dueDate,
      notes: input.notes,
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
    if (dto.lines && original.type !== InvoiceType.INVOICE) {
      throw new BadRequestException('So as faturas a credito (FT) aceitam nota de credito parcial');
    }
    await this.ensureSeries(original.hotelId, InvoiceType.CREDIT_NOTE);
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM invoices ${lockHint()} WHERE id = ${id} ${forUpdate()}`;
      if (!locked || locked.status !== InvoiceStatus.ISSUED) {
        throw new ConflictException('Este documento ja foi creditado');
      }
      if (await tx.receiptLine.count({ where: { invoiceId: id, receipt: { status: 'ISSUED' } } })) {
        throw new ConflictException('Esta fatura tem recibos emitidos: anula-os antes de emitir a nota de credito');
      }
      const previous = await tx.invoiceLine.findMany({
        where: { creditOfLineId: { in: original.lines.map((line) => line.id) } },
        select: { creditOfLineId: true, quantity: true, grossAmount: true },
      });
      const credited = new Map<number, { quantity: Prisma.Decimal; gross: Prisma.Decimal }>();
      for (const line of previous) {
        const current = credited.get(line.creditOfLineId!) ?? { quantity: new Prisma.Decimal(0), gross: new Prisma.Decimal(0) };
        credited.set(line.creditOfLineId!, { quantity: current.quantity.add(line.quantity), gross: current.gross.add(line.grossAmount) });
      }
      const remainingOf = (line: (typeof original.lines)[number]) => new Prisma.Decimal(line.quantity).sub(credited.get(line.id)?.quantity ?? 0);
      const requested = dto.lines
        ? dto.lines.map((item) => {
            const line = original.lines.find((candidate) => candidate.id === item.lineId);
            if (!line) {
              throw new BadRequestException('Linha da fatura nao encontrada');
            }
            return { line, quantity: new Prisma.Decimal(item.quantity) };
          })
        : original.lines.map((line) => ({ line, quantity: remainingOf(line) })).filter((item) => item.quantity.greaterThan(0));
      if (!requested.length) {
        throw new BadRequestException('Nada a creditar nesta fatura');
      }
      const noteLines = requested.map(({ line, quantity }) => {
        const remaining = remainingOf(line);
        if (quantity.greaterThan(remaining)) {
          throw new BadRequestException(`So pode creditar ${remaining.toString()} de ${line.description}`);
        }
        const gross = quantity.equals(remaining)
          ? toMoney(line.grossAmount).sub(credited.get(line.id)?.gross ?? 0)
          : toMoney(new Prisma.Decimal(line.grossAmount).mul(quantity).div(line.quantity));
        const { netAmount, taxAmount, grossAmount } = splitGross(gross, line.taxRate);
        credited.set(line.id, { quantity: (credited.get(line.id)?.quantity ?? new Prisma.Decimal(0)).add(quantity), gross: (credited.get(line.id)?.gross ?? new Prisma.Decimal(0)).add(grossAmount) });
        return {
          description: line.description,
          productCode: line.productCode,
          quantity,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          taxCategory: line.taxCategory,
          exemptionCode: line.exemptionCode,
          exemptionReason: line.exemptionReason,
          netAmount,
          taxAmount,
          grossAmount,
          creditOfLineId: line.id,
        };
      });
      const fully = original.lines.every((line) => remainingOf(line).lessThanOrEqualTo(0));
      const note = await this.createDocument(tx, {
        hotelId: original.hotelId,
        type: InvoiceType.CREDIT_NOTE,
        reservationId: original.reservationId,
        creditOfId: original.id,
        reason: dto.reason,
        customer: original,
        lines: noteLines,
        createdById: user.sub,
      });
      if (fully) {
        await tx.invoice.update({ where: { id }, data: { status: InvoiceStatus.CREDITED } });
        await tx.charge.updateMany({ where: { invoiceId: original.id }, data: { invoiceId: null } });
      }
      await this.audit.log(
        {
          hotelId: original.hotelId,
          userId: user.sub,
          action: 'CREDIT_NOTE',
          entity: 'invoice',
          entityId: note.id,
          summary: `${note.fullNumber} credita ${original.fullNumber} (${note.grossTotal.toFixed(2)} de ${original.grossTotal.toFixed(2)}): ${dto.reason}`,
          data: { originalId: original.id, original: original.fullNumber, total: note.grossTotal.toFixed(2), partial: !fully, reason: dto.reason },
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
      dueDate?: Date | null;
      notes?: string | null;
    },
  ) {
    const hotel = await tx.hotel.findUniqueOrThrow({ where: { id: input.hotelId } });
    const issuedAt = new Date();
    const code = seriesCode(issuedAt);
    const [series] = await tx.$queryRaw<
      { id: number; code: string; nextNumber: number; lastHash: string | null; atValidationCode: string | null }[]
    >`SELECT id, code, nextNumber, lastHash, atValidationCode FROM invoice_series ${lockHint()}
      WHERE hotelId = ${input.hotelId} AND type = ${input.type} AND code = ${code} ${forUpdate()}`;
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
        dueDate: input.dueDate ?? null,
        notes: input.notes ?? null,
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

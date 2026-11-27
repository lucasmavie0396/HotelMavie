import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceType, Prisma, QuoteStatus } from '@prisma/client';
import { localParts } from '../at/at-format';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { localDayWindow, parseDate, todayUtc } from '../common/dates';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { requireOpenCash } from './cash-guard';
import { resolveLines } from './document-lines';
import { CancelQuoteDto, ConvertQuoteDto, CreateQuoteDto, QuoteQueryDto } from './documents.dto';
import { InvoicesService } from './invoices.service';

export const quoteInclude = {
  lines: { orderBy: { position: 'asc' } },
  invoice: { select: { id: true, fullNumber: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.QuoteInclude;

function withExpiry<T extends { status: QuoteStatus; validUntil: Date }>(quote: T) {
  return { ...quote, expired: quote.status === QuoteStatus.OPEN && quote.validUntil < todayUtc() };
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: QuoteQueryDto, user: JwtPayload) {
    const q = query.q?.trim();
    const quotes = await this.prisma.quote.findMany({
      where: {
        hotelId: resolveHotelScope(user, query.hotelId),
        status: query.status,
        issuedAt: localDayWindow(query.from, query.to),
        ...(q ? { OR: [{ fullNumber: { contains: q } }, { customerName: { contains: q } }, { customerTaxId: { contains: q } }] } : {}),
      },
      include: { invoice: { select: { id: true, fullNumber: true } } },
      orderBy: { issuedAt: 'desc' },
      take: 500,
    });
    return quotes.map(withExpiry);
  }

  async findOne(id: number, user: JwtPayload) {
    const quote = await this.prisma.quote.findUnique({ where: { id }, include: quoteInclude });
    if (!quote || !canAccessHotel(user, quote.hotelId)) {
      throw new NotFoundException('Cotacao nao encontrada');
    }
    return withExpiry(quote);
  }

  async create(dto: CreateQuoteDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, dto.hotelId);
    if (!hotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    const validUntil = parseDate(dto.validUntil);
    if (validUntil < todayUtc()) {
      throw new BadRequestException('A validade da cotacao nao pode ser anterior a hoje');
    }
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { currency: true } });
    const lines = await resolveLines(this.prisma, hotelId, dto.lines);
    const year = localParts(new Date()).year;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const last = await tx.quote.findFirst({ where: { hotelId, year }, orderBy: { number: 'desc' }, select: { number: true } });
          const number = (last?.number ?? 0) + 1;
          const quote = await tx.quote.create({
            data: {
              hotelId,
              year,
              number,
              fullNumber: `CT ${year}/${number}`,
              validUntil,
              customerName: dto.customerName?.trim() || 'Consumidor final',
              customerTaxId: dto.customerTaxId?.trim() || null,
              customerAddress: dto.customerAddress?.trim() || null,
              customerEmail: dto.customerEmail?.trim() || null,
              notes: dto.notes?.trim() || null,
              currency: hotel.currency,
              netTotal: sumMoney(lines.map((line) => line.netAmount)),
              taxTotal: sumMoney(lines.map((line) => line.taxAmount)),
              grossTotal: sumMoney(lines.map((line) => line.grossAmount)),
              createdById: user.sub,
              lines: {
                createMany: {
                  data: lines.map((line, index) => ({
                    position: index + 1,
                    productId: line.productId,
                    productCode: line.productCode,
                    description: line.description,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                    discount: line.discount,
                    taxRateId: line.taxRateRef.id,
                    taxRate: line.taxRate,
                    netAmount: line.netAmount,
                    taxAmount: line.taxAmount,
                    grossAmount: line.grossAmount,
                  })),
                },
              },
            },
            include: quoteInclude,
          });
          await this.audit.log(
            {
              hotelId,
              userId: user.sub,
              action: 'QUOTE_CREATE',
              entity: 'quote',
              entityId: quote.id,
              summary: `${quote.fullNumber} para ${quote.customerName} (${quote.grossTotal.toFixed(2)})`,
              data: { total: quote.grossTotal.toFixed(2), validUntil: dto.validUntil },
            },
            tx,
          );
          return withExpiry(quote);
        });
      } catch (error) {
        if (attempt < 4 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
  }

  async cancel(id: number, dto: CancelQuoteDto, user: JwtPayload) {
    const quote = await this.findOne(id, user);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.quote.updateMany({ where: { id, status: QuoteStatus.OPEN }, data: { status: QuoteStatus.CANCELLED, cancelReason: dto.reason } });
      if (!count) {
        throw new ConflictException('Esta cotacao ja nao esta em aberto');
      }
      await this.audit.log(
        { hotelId: quote.hotelId, userId: user.sub, action: 'QUOTE_CANCEL', entity: 'quote', entityId: id, summary: `${quote.fullNumber} anulada: ${dto.reason}`, data: { reason: dto.reason } },
        tx,
      );
      return withExpiry(await tx.quote.findUniqueOrThrow({ where: { id }, include: quoteInclude }));
    });
  }

  async convert(id: number, dto: ConvertQuoteDto, user: JwtPayload) {
    const quote = await this.findOne(id, user);
    if (quote.status !== QuoteStatus.OPEN) {
      throw new ConflictException('Esta cotacao ja nao esta em aberto');
    }
    const customerName = (dto.customerName ?? quote.customerName).trim();
    if (!customerName || customerName === 'Consumidor final') {
      throw new BadRequestException('Indique o cliente: a fatura fica a credito na conta dele');
    }
    await requireOpenCash(this.prisma, quote.hotelId, user.sub);
    const rates = new Map(
      (await this.prisma.taxRate.findMany({ where: { id: { in: quote.lines.flatMap((line) => (line.taxRateId ? [line.taxRateId] : [])) }, active: true } })).map((rate) => [rate.id, rate]),
    );
    const lines = quote.lines.map((line) => {
      const taxRateRef = line.taxRateId ? rates.get(line.taxRateId) : undefined;
      if (!taxRateRef || !taxRateRef.rate.equals(line.taxRate)) {
        throw new ConflictException(`A taxa de IVA de ${line.description} mudou ou foi desativada: faca uma cotacao nova`);
      }
      return { ...line, taxRateRef };
    });
    await this.invoices.ensureSeries(quote.hotelId, InvoiceType.INVOICE);
    return this.prisma.$transaction(async (tx) => {
      const invoice = await this.invoices.issueLines(tx, {
        hotelId: quote.hotelId,
        lines,
        customer: {
          customerName,
          customerTaxId: (dto.customerTaxId ?? quote.customerTaxId ?? '').trim() || undefined,
          customerAddress: (dto.customerAddress ?? quote.customerAddress ?? '').trim() || undefined,
          customerEmail: (dto.customerEmail ?? quote.customerEmail ?? '').trim() || undefined,
        },
        dueDate: dto.dueDate ? parseDate(dto.dueDate) : null,
        notes: quote.notes,
        createdById: user.sub,
      });
      const { count } = await tx.quote.updateMany({ where: { id, status: QuoteStatus.OPEN }, data: { status: QuoteStatus.CONVERTED, invoiceId: invoice.id } });
      if (!count) {
        throw new ConflictException('Esta cotacao ja nao esta em aberto');
      }
      await this.audit.log(
        {
          hotelId: quote.hotelId,
          userId: user.sub,
          action: 'QUOTE_CONVERT',
          entity: 'quote',
          entityId: id,
          summary: `${quote.fullNumber} convertida em ${invoice.fullNumber} (${invoice.grossTotal.toFixed(2)})`,
          data: { invoiceId: invoice.id, invoice: invoice.fullNumber },
        },
        tx,
      );
      return invoice;
    });
  }
}

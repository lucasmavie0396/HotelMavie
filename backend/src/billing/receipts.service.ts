import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, InvoiceType, PaymentMethod, Prisma, ReceiptStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import { DOC_TYPE } from '../at/at-format';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { FolioService } from './folio.service';
import { InvoicesService, seriesCode } from './invoices.service';
import { PaymentTypesService } from './payment-types';

export class ReceiptLineDto {
  @IsInt()
  invoiceId: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
}

export class CreateReceiptDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

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

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique((line: ReceiptLineDto) => line.invoiceId)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines: ReceiptLineDto[];
}

export class CancelReceiptDto {
  @IsString()
  @Length(3, 255)
  reason: string;

  @IsOptional()
  @IsInt()
  cashSessionId?: number;
}

export class OpenInvoicesQueryDto extends HotelQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(230)
  customer?: string;
}

export const receiptInclude = {
  lines: { include: { invoice: { select: { id: true, fullNumber: true, issuedAt: true, grossTotal: true } } } },
} satisfies Prisma.ReceiptInclude;

export function customerKey(invoice: { customerTaxId: string | null; customerName: string }) {
  return invoice.customerTaxId ? `NIF:${invoice.customerTaxId}` : `NOME:${invoice.customerName}`;
}

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folio: FolioService,
    private readonly invoices: InvoicesService,
    private readonly paymentTypes: PaymentTypesService,
    private readonly audit: AuditService,
  ) {}

  async openInvoices(query: OpenInvoicesQueryDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    const invoices = await this.prisma.invoice.findMany({
      where: { hotelId, type: InvoiceType.INVOICE, status: InvoiceStatus.ISSUED },
      include: { receiptLines: { where: { receipt: { status: ReceiptStatus.ISSUED } }, select: { amount: true } } },
      orderBy: { issuedAt: 'asc' },
    });
    return invoices
      .map(({ receiptLines, ...invoice }) => {
        const settled = sumMoney(receiptLines.map((line) => line.amount));
        return { ...invoice, settled, open: toMoney(invoice.grossTotal).sub(settled), customerKey: customerKey(invoice) };
      })
      .filter((invoice) => invoice.open.greaterThan(0) && (!query.customer || invoice.customerKey === query.customer));
  }

  async accounts(query: HotelQueryDto, user: JwtPayload) {
    const open = await this.openInvoices(query, user);
    const accounts = new Map<string, { customerKey: string; customerName: string; customerTaxId: string | null; open: Prisma.Decimal; invoices: number; oldest: Date }>();
    for (const invoice of open) {
      const current = accounts.get(invoice.customerKey);
      if (current) {
        current.open = current.open.add(invoice.open);
        current.invoices++;
      } else {
        accounts.set(invoice.customerKey, {
          customerKey: invoice.customerKey,
          customerName: invoice.customerName,
          customerTaxId: invoice.customerTaxId,
          open: invoice.open,
          invoices: 1,
          oldest: invoice.issuedAt,
        });
      }
    }
    return [...accounts.values()].sort((a, b) => b.open.comparedTo(a.open));
  }

  findAll(query: HotelQueryDto, user: JwtPayload) {
    return this.prisma.receipt.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId) },
      include: receiptInclude,
      orderBy: { issuedAt: 'desc' },
      take: 300,
    });
  }

  async findOne(id: number, user: JwtPayload) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id }, include: receiptInclude });
    if (!receipt || !canAccessHotel(user, receipt.hotelId)) {
      throw new NotFoundException('Recibo nao encontrado');
    }
    return receipt;
  }

  async issue(dto: CreateReceiptDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, dto.hotelId);
    if (!hotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    await this.invoices.ensureSeries(hotelId, InvoiceType.RECEIPT);
    const invoiceIds = dto.lines.map((line) => line.invoiceId);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id IN (${Prisma.join(invoiceIds)}) FOR UPDATE`;
      const invoices = await tx.invoice.findMany({
        where: { id: { in: invoiceIds } },
        include: { receiptLines: { where: { receipt: { status: ReceiptStatus.ISSUED } }, select: { amount: true } } },
      });
      if (invoices.length !== invoiceIds.length || invoices.some((invoice) => invoice.hotelId !== hotelId)) {
        throw new NotFoundException('Fatura nao encontrada neste hotel');
      }
      const keys = new Set(invoices.map(customerKey));
      if (keys.size > 1) {
        throw new BadRequestException('Um recibo so pode liquidar faturas do mesmo cliente');
      }
      for (const line of dto.lines) {
        const invoice = invoices.find((item) => item.id === line.invoiceId)!;
        if (invoice.type !== InvoiceType.INVOICE || invoice.status !== InvoiceStatus.ISSUED) {
          throw new ConflictException(`${invoice.fullNumber} nao esta em aberto`);
        }
        const open = toMoney(invoice.grossTotal).sub(sumMoney(invoice.receiptLines.map((l) => l.amount)));
        if (toMoney(line.amount).greaterThan(open)) {
          throw new BadRequestException(`O valor para ${invoice.fullNumber} excede o montante em divida (${open.toFixed(2)})`);
        }
      }

      const paymentType = await this.paymentTypes.resolve(tx, hotelId, dto);
      const issuedAt = new Date();
      const code = seriesCode(issuedAt);
      const [series] = await tx.$queryRaw<{ id: number; code: string; nextNumber: number; atValidationCode: string | null }[]>`
        SELECT id, code, nextNumber, atValidationCode FROM invoice_series
        WHERE hotelId = ${hotelId} AND type = ${InvoiceType.RECEIPT} AND code = ${code} FOR UPDATE`;
      if (!series) {
        throw new ConflictException('Serie de recibos indisponivel, tenta novamente');
      }
      const number = Number(series.nextNumber);
      const amount = sumMoney(dto.lines.map((line) => line.amount));
      const reference = invoices[0];

      const receipt = await tx.receipt.create({
        data: {
          hotelId,
          seriesId: series.id,
          number,
          fullNumber: `${DOC_TYPE.RECEIPT} ${series.code}/${number}`,
          atcud: series.atValidationCode ? `${series.atValidationCode}-${number}` : null,
          issuedAt,
          customerName: reference.customerName,
          customerTaxId: reference.customerTaxId,
          amount,
          method: paymentType.method,
          paymentTypeId: paymentType.paymentTypeId,
          reference: dto.reference,
          createdById: user.sub,
          lines: { createMany: { data: dto.lines.map((line) => ({ invoiceId: line.invoiceId, amount: line.amount })) } },
        },
        include: receiptInclude,
      });
      await tx.invoiceSeries.update({ where: { id: series.id }, data: { nextNumber: number + 1 } });

      const payment = await this.folio.recordPayment(
        tx,
        {
          hotelId,
          amount,
          method: paymentType.method,
          paymentTypeId: paymentType.paymentTypeId,
          cashSessionId: dto.cashSessionId,
          reference: dto.reference,
          notes: receipt.fullNumber,
          createdById: user.sub,
        },
        user,
      );
      await tx.payment.update({ where: { id: payment.id }, data: { receiptId: receipt.id } });
      return receipt;
    });
  }

  async cancel(id: number, dto: CancelReceiptDto, user: JwtPayload) {
    const receipt = await this.findOne(id, user);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.receipt.updateMany({
        where: { id, status: ReceiptStatus.ISSUED },
        data: { status: ReceiptStatus.CANCELLED, cancelledAt: new Date(), cancelReason: dto.reason },
      });
      if (!count) {
        throw new ConflictException('Este recibo ja foi anulado');
      }
      const reversal = await this.folio.recordPayment(
        tx,
        {
          hotelId: receipt.hotelId,
          amount: toMoney(receipt.amount).neg(),
          method: receipt.method,
          paymentTypeId: receipt.paymentTypeId,
          cashSessionId: dto.cashSessionId,
          notes: `Anulacao ${receipt.fullNumber}`,
          createdById: user.sub,
        },
        user,
      );
      await tx.payment.update({ where: { id: reversal.id }, data: { receiptId: receipt.id } });
      await this.audit.log(
        {
          hotelId: receipt.hotelId,
          userId: user.sub,
          action: 'RECEIPT_CANCEL',
          entity: 'receipt',
          entityId: receipt.id,
          summary: `${receipt.fullNumber} anulado (${toMoney(receipt.amount).toFixed(2)}): ${dto.reason}`,
        },
        tx,
      );
      return tx.receipt.findUniqueOrThrow({ where: { id }, include: receiptInclude });
    });
  }
}

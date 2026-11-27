import { BadRequestException } from '@nestjs/common';
import { Prisma, TaxRate } from '@prisma/client';
import { splitGross, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentLineDto } from './documents.dto';

export interface ResolvedLine {
  productId: number | null;
  productCode: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  taxRateRef: TaxRate;
  taxRate: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
}

export async function resolveLines(prisma: PrismaService, hotelId: number, lines: DocumentLineDto[]): Promise<ResolvedLine[]> {
  const productIds = [...new Set(lines.flatMap((line) => (line.productId ? [line.productId] : [])))];
  const taxIds = [...new Set(lines.flatMap((line) => (line.taxRateId ? [line.taxRateId] : [])))];
  const products = new Map(
    (await prisma.product.findMany({ where: { id: { in: productIds }, hotelId }, include: { taxRate: true } })).map((product) => [product.id, product]),
  );
  const rates = new Map((await prisma.taxRate.findMany({ where: { id: { in: taxIds }, hotelId, active: true } })).map((rate) => [rate.id, rate]));
  return lines.map((line, index) => {
    const position = index + 1;
    const product = line.productId ? products.get(line.productId) : undefined;
    if (line.productId && !product) {
      throw new BadRequestException(`Linha ${position}: produto nao encontrado`);
    }
    const description = (line.description?.trim() || product?.name || '').slice(0, 200);
    if (!description) {
      throw new BadRequestException(`Linha ${position}: indique a descricao`);
    }
    const taxRateRef = line.taxRateId ? rates.get(line.taxRateId) : product?.taxRate && product.taxRate.active ? product.taxRate : undefined;
    if (!taxRateRef) {
      throw new BadRequestException(`Linha ${position}: escolha a taxa de IVA`);
    }
    const quantity = new Prisma.Decimal(line.quantity);
    const unitPrice = toMoney(line.unitPrice ?? product?.price ?? 0);
    const discount = toMoney(line.discount ?? 0);
    const gross = quantity.mul(unitPrice).toDecimalPlaces(2).sub(discount);
    if (gross.isNegative()) {
      throw new BadRequestException(`Linha ${position}: o desconto nao pode ser maior que o valor da linha`);
    }
    const { netAmount, taxAmount, grossAmount } = splitGross(gross, taxRateRef.rate);
    return {
      productId: product?.id ?? null,
      productCode: product ? `P${product.id}` : null,
      description,
      quantity,
      unitPrice,
      discount,
      taxRateRef,
      taxRate: taxRateRef.rate,
      netAmount,
      taxAmount,
      grossAmount,
    };
  });
}

export function chargeData(line: Pick<ResolvedLine, 'description' | 'quantity' | 'unitPrice' | 'discount' | 'grossAmount' | 'productCode' | 'taxRateRef'>) {
  const discounted = line.discount.greaterThan(0);
  return {
    description: discounted ? `${line.description} (desconto ${line.discount.toFixed(2)})`.slice(0, 200) : line.description,
    quantity: line.quantity,
    unitPrice: discounted ? line.grossAmount.div(line.quantity).toDecimalPlaces(2) : line.unitPrice,
    taxRateId: line.taxRateRef.id,
    taxRate: line.taxRateRef.rate,
    total: line.grossAmount,
    productCode: line.productCode,
  };
}

import { Prisma } from '@prisma/client';

export type DecimalLike = Prisma.Decimal | number | string;

export function toMoney(value: DecimalLike) {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

export function sumMoney(values: DecimalLike[]) {
  return values.reduce<Prisma.Decimal>((total, value) => total.add(value), new Prisma.Decimal(0)).toDecimalPlaces(2);
}

export function splitGross(gross: DecimalLike, rate: DecimalLike) {
  const grossAmount = toMoney(gross);
  const netAmount = grossAmount.div(new Prisma.Decimal(rate).div(100).add(1)).toDecimalPlaces(2);
  return { netAmount, taxAmount: grossAmount.sub(netAmount), grossAmount };
}

import { BadRequestException } from '@nestjs/common';
import { OrderStatus, Prisma, ReservationStatus, StockMovementType } from '@prisma/client';
import { addDays, nightsBetween, parseDate } from '../common/dates';
import { toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

export const SOLD_STATUSES: ReservationStatus[] = [ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN, ReservationStatus.CHECKED_OUT];

export function reportPeriod(fromValue: string, toValue: string) {
  const from = parseDate(fromValue);
  const to = addDays(parseDate(toValue), 1);
  const days = nightsBetween(from, to);
  if (days < 1 || days > 366) {
    throw new BadRequestException('O periodo tem de ter entre 1 e 366 dias');
  }
  return { from, to, days };
}

export async function summaryData(prisma: PrismaService, hotelId: number | undefined, fromValue: string, toValue: string) {
  const { from, to, days } = reportPeriod(fromValue, toValue);
  const period = { gte: from, lt: to };

  const [roomCount, reservations, charges, payments, invoices, orderItems, sources, cancellations, sales] = await Promise.all([
    prisma.room.count({ where: { hotelId } }),
    prisma.reservation.findMany({
      where: { hotelId, status: { in: SOLD_STATUSES }, checkIn: { lt: to }, checkOut: { gt: from } },
      select: { checkIn: true, checkOut: true, pricePerNight: true },
    }),
    prisma.charge.groupBy({ by: ['type'], where: { hotelId, createdAt: period }, _sum: { total: true } }),
    prisma.payment.groupBy({ by: ['method'], where: { hotelId, createdAt: period }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.groupBy({ by: ['type'], where: { hotelId, issuedAt: period }, _sum: { grossTotal: true, taxTotal: true }, _count: { _all: true } }),
    prisma.orderItem.groupBy({
      by: ['productId', 'description'],
      where: { order: { hotelId, status: OrderStatus.CLOSED, closedAt: period }, voidedAt: null },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 10,
    }),
    prisma.reservation.groupBy({ by: ['source'], where: { hotelId, createdAt: period }, _count: { _all: true } }),
    prisma.reservation.count({
      where: { hotelId, status: { in: [ReservationStatus.CANCELLED, ReservationStatus.NO_SHOW] }, updatedAt: period },
    }),
    prisma.stockMovement.findMany({
      where: { type: StockMovementType.SALE, createdAt: period, warehouse: { hotelId } },
      select: { quantity: true, unitCost: true },
    }),
  ]);
  const costOfSales = sales.reduce((sum, movement) => sum.add(movement.quantity.abs().mul(movement.unitCost ?? 0)), new Prisma.Decimal(0));
  const fnbRevenue = charges
    .filter((row) => row.type === 'RESTAURANT' || row.type === 'BAR')
    .reduce((sum, row) => sum.add(row._sum.total ?? 0), new Prisma.Decimal(0));

  let roomNights = 0;
  let roomRevenue = new Prisma.Decimal(0);
  for (const reservation of reservations) {
    const start = reservation.checkIn > from ? reservation.checkIn : from;
    const end = reservation.checkOut < to ? reservation.checkOut : to;
    const nights = nightsBetween(start, end);
    roomNights += nights;
    roomRevenue = roomRevenue.add(reservation.pricePerNight.mul(nights));
  }
  const available = roomCount * days;

  return {
    period: { from: fromValue, to: toValue, days },
    occupancy: {
      rooms: roomCount,
      roomNightsAvailable: available,
      roomNightsSold: roomNights,
      rate: available ? Math.round((roomNights / available) * 1000) / 10 : 0,
      roomRevenue: toMoney(roomRevenue),
      adr: roomNights ? toMoney(roomRevenue.div(roomNights)) : toMoney(0),
      revpar: available ? toMoney(roomRevenue.div(available)) : toMoney(0),
    },
    revenueByType: charges.map((row) => ({ type: row.type, total: toMoney(row._sum.total ?? 0) })),
    paymentsByMethod: payments.map((row) => ({ method: row.method, count: row._count._all, total: toMoney(row._sum.amount ?? 0) })),
    invoices: invoices.map((row) => ({
      type: row.type,
      count: row._count._all,
      total: toMoney(row._sum.grossTotal ?? 0),
      tax: toMoney(row._sum.taxTotal ?? 0),
    })),
    topProducts: orderItems.map((row) => ({
      productId: row.productId,
      name: row.description,
      quantity: row._sum.quantity ?? 0,
      total: toMoney(row._sum.total ?? 0),
    })),
    foodAndBeverage: {
      revenue: toMoney(fnbRevenue),
      costOfSales: toMoney(costOfSales),
      costPercent: fnbRevenue.isZero() ? 0 : Number(costOfSales.div(fnbRevenue).mul(100).toFixed(1)),
    },
    reservationsBySource: sources.map((row) => ({ source: row.source, count: row._count._all })),
    cancellations,
  };
}

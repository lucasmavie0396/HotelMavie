import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { OrderStatus, Prisma, PurchaseStatus, ReservationStatus, StockMovementType, UserRole } from '@prisma/client';
import { IsDateString, Length } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { addDays, nightsBetween, parseDate, todayUtc } from '../common/dates';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { resolveHotelScope } from '../common/hotel-scope';
import { toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

class ReportQueryDto extends HotelQueryDto {
  @IsDateString({ strict: true })
  @Length(10, 10)
  from: string;

  @IsDateString({ strict: true })
  @Length(10, 10)
  to: string;
}

const SOLD_STATUSES: ReservationStatus[] = [ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN, ReservationStatus.CHECKED_OUT];

@Controller()
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('reports/summary')
  async summary(@Query() query: ReportQueryDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    const from = parseDate(query.from);
    const to = addDays(parseDate(query.to), 1);
    const days = nightsBetween(from, to);
    if (days < 1 || days > 366) {
      throw new BadRequestException('O periodo tem de ter entre 1 e 366 dias');
    }
    const period = { gte: from, lt: to };

    const [roomCount, reservations, charges, payments, invoices, orderItems, sources, cancellations, sales] = await Promise.all([
      this.prisma.room.count({ where: { hotelId } }),
      this.prisma.reservation.findMany({
        where: { hotelId, status: { in: SOLD_STATUSES }, checkIn: { lt: to }, checkOut: { gt: from } },
        select: { checkIn: true, checkOut: true, pricePerNight: true },
      }),
      this.prisma.charge.groupBy({ by: ['type'], where: { hotelId, createdAt: period }, _sum: { total: true } }),
      this.prisma.payment.groupBy({ by: ['method'], where: { hotelId, createdAt: period }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.invoice.groupBy({ by: ['type'], where: { hotelId, issuedAt: period }, _sum: { grossTotal: true, taxTotal: true }, _count: { _all: true } }),
      this.prisma.orderItem.groupBy({
        by: ['productId', 'description'],
        where: { order: { hotelId, status: OrderStatus.CLOSED, closedAt: period } },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 10,
      }),
      this.prisma.reservation.groupBy({ by: ['source'], where: { hotelId, createdAt: period }, _count: { _all: true } }),
      this.prisma.reservation.count({
        where: { hotelId, status: { in: [ReservationStatus.CANCELLED, ReservationStatus.NO_SHOW] }, updatedAt: period },
      }),
      this.prisma.stockMovement.findMany({
        where: { type: StockMovementType.SALE, createdAt: period, warehouse: { hotelId } },
        select: { quantity: true, unitCost: true },
      }),
    ]);
    const costOfSales = sales.reduce(
      (sum, movement) => sum.add(movement.quantity.abs().mul(movement.unitCost ?? 0)),
      new Prisma.Decimal(0),
    );
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
      period: { from: query.from, to: query.to, days },
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

  @Get('notifications')
  async notifications(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    const today = todayUtc();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);

    const [pendingOnline, arrivals, overdue, staleCash, products, drafts] = await Promise.all([
      this.prisma.reservation.count({ where: { hotelId, status: ReservationStatus.PENDING, source: 'ONLINE' } }),
      this.prisma.reservation.count({
        where: { hotelId, checkIn: { lte: today }, checkOut: { gt: today }, status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] } },
      }),
      this.prisma.reservation.count({ where: { hotelId, status: ReservationStatus.CHECKED_IN, checkOut: { lt: today } } }),
      this.prisma.cashSession.count({ where: { closedAt: null, openedAt: { lt: dayAgo }, register: { hotelId } } }),
      this.prisma.product.findMany({
        where: { hotelId, trackStock: true, active: true },
        select: { id: true, name: true, minStock: true, stockLevels: { select: { quantity: true } } },
      }),
      user.role === UserRole.RECEPTION ? 0 : this.prisma.purchase.count({ where: { hotelId, status: PurchaseStatus.DRAFT } }),
    ]);
    const lowStock = products.filter((product) =>
      product.stockLevels.reduce((sum, level) => sum.add(level.quantity), new Prisma.Decimal(0)).lessThan(product.minStock),
    );

    const items = [
      pendingOnline && { kind: 'warning', text: `${pendingOnline} reserva(s) online por confirmar`, link: '/reservas' },
      arrivals && { kind: 'info', text: `${arrivals} chegada(s) por fazer check-in hoje`, link: '/' },
      overdue && { kind: 'danger', text: `${overdue} hospede(s) com a saida ja ultrapassada`, link: '/' },
      staleCash && { kind: 'warning', text: `${staleCash} caixa(s) abertas ha mais de 24h`, link: '/caixa' },
      lowStock.length && {
        kind: 'warning',
        text: `Stock abaixo do minimo: ${lowStock.slice(0, 3).map((p) => p.name).join(', ')}${lowStock.length > 3 ? '...' : ''}`,
        link: '/stocks',
      },
      drafts && { kind: 'info', text: `${drafts} compra(s) em rascunho por receber`, link: '/compras' },
    ].filter(Boolean);
    return items;
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ChargeType, OrderStatus, Prisma, ReservationStatus, RoomStatus, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { addDays, todayUtc } from '../common/dates';
import { resolveHotelScope } from '../common/hotel-scope';
import { toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { reservationInclude } from '../reservations/reservations.service';

class DashboardQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;
}

export const FORECAST_DAYS = 14;
export const REVENUE_DAYS = 14;
const SOURCE_DAYS = 30;

const iso = (date: Date) => date.toISOString().slice(0, 10);

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async summary(@Query() query: DashboardQueryDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    const today = todayUtc();
    const forecastEnd = addDays(today, FORECAST_DAYS);
    const revenueStart = addDays(today, -(REVENUE_DAYS - 1));
    const tomorrow = addDays(today, 1);
    const seesMoney = user.role !== UserRole.RECEPTION;

    const [roomGroups, arrivals, departures, inHouse, stays, sources, pendingRequests, pendingDeposits, openOrders, openSessions, charges] =
      await Promise.all([
        this.prisma.room.groupBy({ by: ['status'], where: { hotelId }, _count: { _all: true } }),
        this.prisma.reservation.findMany({
          where: {
            hotelId,
            checkIn: { lte: today },
            checkOut: { gt: today },
            status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
          },
          include: reservationInclude,
          orderBy: { checkIn: 'asc' },
        }),
        this.prisma.reservation.findMany({
          where: { hotelId, checkOut: { lte: today }, status: ReservationStatus.CHECKED_IN },
          include: reservationInclude,
          orderBy: { checkOut: 'asc' },
        }),
        this.prisma.reservation.count({ where: { hotelId, status: ReservationStatus.CHECKED_IN } }),
        this.prisma.reservation.findMany({
          where: {
            hotelId,
            status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN] },
            checkIn: { lt: forecastEnd },
            checkOut: { gte: today },
          },
          select: { checkIn: true, checkOut: true, status: true },
        }),
        this.prisma.reservation.groupBy({
          by: ['source'],
          where: { hotelId, createdAt: { gte: addDays(today, -(SOURCE_DAYS - 1)) } },
          _count: { _all: true },
        }),
        this.prisma.reservation.count({ where: { hotelId, status: ReservationStatus.PENDING } }),
        this.prisma.reservation.count({
          where: { hotelId, status: ReservationStatus.PENDING, depositAmount: { not: null }, depositPaymentId: null },
        }),
        this.prisma.order.count({ where: { hotelId, status: OrderStatus.OPEN } }),
        this.prisma.cashSession.count({ where: { closedAt: null, register: { hotelId } } }),
        seesMoney
          ? this.prisma.charge.findMany({
              where: { hotelId, createdAt: { gte: revenueStart, lt: tomorrow } },
              select: { createdAt: true, type: true, total: true },
            })
          : Promise.resolve([]),
      ]);

    const rooms = Object.fromEntries(Object.values(RoomStatus).map((status) => [status, 0])) as Record<RoomStatus, number>;
    for (const group of roomGroups) {
      rooms[group.status] = group._count._all;
    }
    const totalRooms = Object.values(rooms).reduce((sum, count) => sum + count, 0);

    const forecast = Array.from({ length: FORECAST_DAYS }, (_, index) => {
      const day = addDays(today, index);
      const staying = stays.filter((stay) => stay.checkIn <= day && stay.checkOut > day);
      const confirmed = staying.filter((stay) => stay.status !== ReservationStatus.PENDING).length;
      return {
        date: iso(day),
        confirmed,
        pending: staying.length - confirmed,
        arrivals: stays.filter((stay) => iso(stay.checkIn) === iso(day)).length,
        departures: stays.filter((stay) => iso(stay.checkOut) === iso(day)).length,
        occupancy: totalRooms ? Math.round((staying.length / totalRooms) * 100) : 0,
      };
    });

    const revenue = seesMoney
      ? Array.from({ length: REVENUE_DAYS }, (_, index) => {
          const date = iso(addDays(revenueStart, index));
          const totals: Record<ChargeType, Prisma.Decimal> = {
            ACCOMMODATION: new Prisma.Decimal(0),
            RESTAURANT: new Prisma.Decimal(0),
            BAR: new Prisma.Decimal(0),
            EXTRA: new Prisma.Decimal(0),
          };
          for (const charge of charges) {
            if (iso(charge.createdAt) === date) totals[charge.type] = totals[charge.type].add(charge.total);
          }
          return {
            date,
            accommodation: toMoney(totals.ACCOMMODATION),
            restaurant: toMoney(totals.RESTAURANT),
            bar: toMoney(totals.BAR),
            extra: toMoney(totals.EXTRA),
          };
        })
      : null;
    const todayRevenue = revenue
      ? Object.entries(revenue[revenue.length - 1])
          .filter(([key]) => key !== 'date')
          .reduce((sum, [, value]) => sum.add(value as Prisma.Decimal), new Prisma.Decimal(0))
      : null;

    return {
      rooms,
      totalRooms,
      inHouse,
      occupancy: totalRooms ? Math.round((inHouse / totalRooms) * 100) : 0,
      arrivals,
      departures,
      kpis: {
        arrivalsToday: arrivals.length,
        departuresToday: departures.length,
        pendingRequests,
        pendingDeposits,
        openOrders,
        openSessions,
        revenueToday: todayRevenue ? toMoney(todayRevenue) : null,
      },
      forecast,
      revenue,
      sources: sources.map((row) => ({ source: row.source, count: row._count._all })),
    };
  }
}

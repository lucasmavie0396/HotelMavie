import { Controller, Get, Query } from '@nestjs/common';
import { ReservationStatus, RoomStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { todayUtc } from '../common/dates';
import { resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { reservationInclude } from '../reservations/reservations.service';

class DashboardQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async summary(@Query() query: DashboardQueryDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    const today = todayUtc();

    const [roomGroups, arrivals, departures, inHouse] = await Promise.all([
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
    ]);

    const rooms = Object.fromEntries(Object.values(RoomStatus).map((status) => [status, 0])) as Record<RoomStatus, number>;
    for (const group of roomGroups) {
      rooms[group.status] = group._count._all;
    }
    const totalRooms = Object.values(rooms).reduce((sum, count) => sum + count, 0);

    return {
      rooms,
      totalRooms,
      inHouse,
      occupancy: totalRooms ? Math.round((inHouse / totalRooms) * 100) : 0,
      arrivals,
      departures,
    };
  }
}

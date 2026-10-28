import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ReservationSource } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { assertStayRange, parseDate, todayUtc } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { PublicAvailabilityQueryDto, PublicBookingDto } from './dto/public-booking.dto';

@Public()
@Controller('public/hotels/:slug')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationsService,
  ) {}

  @Get()
  async hotel(@Param('slug') slug: string) {
    const hotel = await this.prisma.hotel.findFirst({
      where: { publicSlug: slug, publicEnabled: true },
      select: {
        name: true,
        publicSlug: true,
        email: true,
        phone: true,
        address: true,
        currency: true,
        rooms: { select: { type: true, capacity: true, pricePerNight: true, description: true } },
      },
    });
    if (!hotel) {
      throw new NotFoundException('Hotel nao encontrado');
    }
    const { rooms, ...info } = hotel;
    return { ...info, roomTypes: this.groupByType(rooms) };
  }

  @Get('availability')
  async availability(@Param('slug') slug: string, @Query() query: PublicAvailabilityQueryDto) {
    const hotel = await this.findHotel(slug);
    const { checkIn, checkOut, nights } = this.parseStay(query.checkIn, query.checkOut);
    const rooms = await this.reservations.findAvailableRooms(hotel.id, checkIn, checkOut, query.guests ?? 1);
    return this.groupByType(rooms).map((type) => ({ ...type, nights, total: (Number(type.pricePerNight) * nights).toFixed(2) }));
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reservations')
  async book(@Param('slug') slug: string, @Body() dto: PublicBookingDto) {
    const hotel = await this.findHotel(slug);
    const { checkIn, checkOut } = this.parseStay(dto.checkIn, dto.checkOut);
    const children = dto.children ?? 0;
    const candidates = await this.reservations.findAvailableRooms(hotel.id, checkIn, checkOut, dto.adults + children, dto.roomType);
    if (!candidates.length) {
      throw new ConflictException('Ja nao ha quartos deste tipo disponiveis para essas datas');
    }

    const email = dto.email.toLowerCase();
    const guest =
      (await this.prisma.guest.findFirst({ where: { hotelId: hotel.id, email } })) ??
      (await this.prisma.guest.create({
        data: { hotelId: hotel.id, firstName: dto.firstName, lastName: dto.lastName, email, phone: dto.phone },
      }));

    for (const room of candidates) {
      try {
        const reservation = await this.reservations.book({
          hotelId: hotel.id,
          guestId: guest.id,
          roomId: room.id,
          checkIn,
          checkOut,
          adults: dto.adults,
          children,
          source: ReservationSource.ONLINE,
          notes: dto.notes,
        });
        return {
          code: reservation.code,
          status: reservation.status,
          checkIn: dto.checkIn,
          checkOut: dto.checkOut,
          roomType: room.type,
          totalAmount: reservation.totalAmount,
          currency: hotel.currency,
        };
      } catch (error) {
        if (!(error instanceof ConflictException)) {
          throw error;
        }
      }
    }
    throw new ConflictException('Ja nao ha quartos deste tipo disponiveis para essas datas');
  }

  private async findHotel(slug: string) {
    const hotel = await this.prisma.hotel.findFirst({ where: { publicSlug: slug, publicEnabled: true } });
    if (!hotel) {
      throw new NotFoundException('Hotel nao encontrado');
    }
    return hotel;
  }

  private parseStay(checkInValue: string, checkOutValue: string) {
    const checkIn = parseDate(checkInValue);
    const checkOut = parseDate(checkOutValue);
    if (checkIn < todayUtc()) {
      throw new BadRequestException('A data de entrada nao pode ser no passado');
    }
    return { checkIn, checkOut, nights: assertStayRange(checkIn, checkOut) };
  }

  private groupByType<T extends { type: string; capacity: number; pricePerNight: { toString(): string }; description: string | null }>(
    rooms: T[],
  ) {
    const types = new Map<string, { type: string; capacity: number; pricePerNight: string; description: string | null; available: number }>();
    for (const room of rooms) {
      const price = Number(room.pricePerNight);
      const current = types.get(room.type);
      if (!current) {
        types.set(room.type, {
          type: room.type,
          capacity: room.capacity,
          pricePerNight: price.toFixed(2),
          description: room.description,
          available: 1,
        });
        continue;
      }
      current.available++;
      current.capacity = Math.max(current.capacity, room.capacity);
      current.description ??= room.description;
      if (price < Number(current.pricePerNight)) {
        current.pricePerNight = price.toFixed(2);
      }
    }
    return [...types.values()].sort((a, b) => Number(a.pricePerNight) - Number(b.pricePerNight));
  }
}

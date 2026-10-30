import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { PaymentMethod, Prisma, ReservationSource } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { PaymentTypesService } from '../billing/payment-types';
import { Public } from '../common/decorators/public.decorator';
import { assertStayRange, parseDate, todayUtc } from '../common/dates';
import { toMoney } from '../common/money';
import { MailService } from '../mail/mail.service';
import { bookingRequestEmail, newBookingAlertEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { PublicAvailabilityQueryDto, PublicBookingDto } from './dto/public-booking.dto';

const MAX_TYPE_IMAGES = 8;

const roomSelect = {
  type: true,
  capacity: true,
  pricePerNight: true,
  description: true,
  images: { select: { file: true }, orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] },
};

@Public()
@Controller('public/hotels/:slug')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationsService,
    private readonly paymentTypes: PaymentTypesService,
    private readonly mail: MailService,
  ) {}

  @Get()
  async hotel(@Param('slug') slug: string) {
    const hotel = await this.prisma.hotel.findFirst({
      where: { publicSlug: slug, publicEnabled: true },
      select: {
        id: true,
        name: true,
        publicSlug: true,
        email: true,
        phone: true,
        address: true,
        city: true,
        currency: true,
        logoFile: true,
        publicDescription: true,
        depositPercent: true,
        paymentInstructions: true,
        rooms: { select: roomSelect },
      },
    });
    if (!hotel) {
      throw new NotFoundException('Hotel nao encontrado');
    }
    const { rooms, id, depositPercent, ...info } = hotel;
    return {
      ...info,
      depositPercent: Number(depositPercent),
      paymentTypes: await this.depositTypes(id),
      roomTypes: this.groupByType(rooms),
    };
  }

  @Get('availability')
  async availability(@Param('slug') slug: string, @Query() query: PublicAvailabilityQueryDto) {
    const hotel = await this.findHotel(slug);
    const { checkIn, checkOut, nights } = this.parseStay(query.checkIn, query.checkOut);
    const rooms = await this.reservations.findAvailableRooms(hotel.id, checkIn, checkOut, query.guests ?? 1, undefined, undefined, true);
    return this.groupByType(rooms).map((type) => {
      const total = toMoney(new Prisma.Decimal(type.pricePerNight).mul(nights));
      return { ...type, nights, total: total.toFixed(2), deposit: toMoney(total.mul(hotel.depositPercent).div(100)).toFixed(2) };
    });
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reservations')
  async book(@Param('slug') slug: string, @Body() dto: PublicBookingDto) {
    const hotel = await this.findHotel(slug);
    const { checkIn, checkOut } = this.parseStay(dto.checkIn, dto.checkOut);
    const needsDeposit = hotel.depositPercent.greaterThan(0);
    const reference = dto.depositReference?.trim();
    if (needsDeposit && !reference) {
      throw new BadRequestException(`Indica a referencia do pagamento do sinal (${Number(hotel.depositPercent)}% do valor da reserva)`);
    }
    if (dto.depositPaymentTypeId && !(await this.depositTypes(hotel.id)).some((type) => type.id === dto.depositPaymentTypeId)) {
      throw new BadRequestException('Forma de pagamento invalida');
    }
    const children = dto.children ?? 0;
    const companions = dto.companions ?? [];
    if (companions.length > dto.adults + children - 1) {
      throw new BadRequestException(`A reserva e para ${dto.adults + children} pessoa(s): no maximo ${dto.adults + children - 1} acompanhante(s) alem do titular`);
    }
    if (companions.filter((companion) => companion.isChild).length > children) {
      throw new BadRequestException('Ha mais criancas nos acompanhantes do que na reserva');
    }
    const candidates = await this.reservations.findAvailableRooms(hotel.id, checkIn, checkOut, dto.adults + children, dto.roomType);
    if (!candidates.length) {
      throw new ConflictException('Ja nao ha quartos deste tipo disponiveis para essas datas');
    }

    const email = dto.email.toLowerCase();
    const text = (value?: string) => value?.trim() || null;
    const personal = {
      phone: text(dto.phone),
      birthDate: dto.birthDate ? new Date(`${dto.birthDate}T00:00:00.000Z`) : null,
      nationality: text(dto.nationality),
      documentType: text(dto.documentType),
      documentNumber: text(dto.documentNumber),
      taxId: text(dto.taxId),
      address: text(dto.address),
    };
    const existing = await this.prisma.guest.findFirst({ where: { hotelId: hotel.id, email } });
    const guest = existing
      ? await this.prisma.guest.update({
          where: { id: existing.id },
          data: Object.fromEntries(Object.entries(personal).filter(([key, value]) => value !== null && !existing[key as keyof typeof personal])),
        })
      : await this.prisma.guest.create({ data: { hotelId: hotel.id, firstName: dto.firstName.trim(), lastName: dto.lastName.trim(), email, ...personal } });

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
          deposit: needsDeposit ? { percent: hotel.depositPercent, reference, paymentTypeId: dto.depositPaymentTypeId } : undefined,
          companions,
        });
        const stay = {
          code: reservation.code,
          guestName: `${guest.firstName} ${guest.lastName}`,
          roomType: room.type,
          checkIn: dto.checkIn,
          checkOut: dto.checkOut,
          adults: dto.adults,
          children,
          totalAmount: reservation.totalAmount,
          depositAmount: reservation.depositAmount,
          depositReference: reservation.depositReference,
        };
        const toGuest = bookingRequestEmail(hotel, stay);
        this.mail.queue({ hotelId: hotel.id, kind: 'BOOKING_REQUEST', to: email, replyTo: hotel.email, relatedId: reservation.id, ...toGuest });
        if (hotel.email) {
          const toHotel = newBookingAlertEmail(hotel, stay, email);
          this.mail.queue({ hotelId: hotel.id, kind: 'BOOKING_ALERT', to: hotel.email, replyTo: email, relatedId: reservation.id, ...toHotel });
        }
        return {
          code: reservation.code,
          status: reservation.status,
          checkIn: dto.checkIn,
          checkOut: dto.checkOut,
          roomType: room.type,
          totalAmount: reservation.totalAmount,
          depositAmount: reservation.depositAmount,
          depositReference: reservation.depositReference,
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

  private async depositTypes(hotelId: number) {
    await this.paymentTypes.ensureDefaults(hotelId);
    return this.prisma.paymentType.findMany({
      where: { hotelId, active: true, kind: { not: PaymentMethod.CASH } },
      select: { id: true, name: true, requiresReference: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
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

  private groupByType<
    T extends { type: string; capacity: number; pricePerNight: { toString(): string }; description: string | null; images?: { file: string }[] },
  >(rooms: T[]) {
    const types = new Map<
      string,
      { type: string; capacity: number; pricePerNight: string; description: string | null; available: number; images: string[] }
    >();
    for (const room of rooms) {
      const price = Number(room.pricePerNight);
      const files = (room.images ?? []).map((image) => image.file);
      const current = types.get(room.type);
      if (!current) {
        types.set(room.type, {
          type: room.type,
          capacity: room.capacity,
          pricePerNight: price.toFixed(2),
          description: room.description,
          available: 1,
          images: files.slice(0, MAX_TYPE_IMAGES),
        });
        continue;
      }
      current.available++;
      current.capacity = Math.max(current.capacity, room.capacity);
      current.description ??= room.description;
      for (const file of files) {
        if (current.images.length < MAX_TYPE_IMAGES && !current.images.includes(file)) current.images.push(file);
      }
      if (price < Number(current.pricePerNight)) {
        current.pricePerNight = price.toFixed(2);
      }
    }
    return [...types.values()].sort((a, b) => Number(a.pricePerNight) - Number(b.pricePerNight));
  }
}

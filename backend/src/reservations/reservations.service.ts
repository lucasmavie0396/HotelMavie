import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReservationSource, ReservationStatus, RoomStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { JwtPayload } from '../auth/jwt-payload';
import { FolioService } from '../billing/folio.service';
import { addDays, assertStayRange, parseDate, todayUtc } from '../common/dates';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { toMoney } from '../common/money';
import { MailService } from '../mail/mail.service';
import { bookingConfirmedEmail, mailLang } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { CompanionDto, companionData } from './dto/companion.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { AvailabilityQueryDto, ReservationQueryDto } from './dto/reservation-query.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';

export const ACTIVE_STATUSES: ReservationStatus[] = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
  ReservationStatus.CHECKED_IN,
];

const EDITABLE_STATUSES: ReservationStatus[] = [ReservationStatus.PENDING, ReservationStatus.CONFIRMED];

export const reservationInclude = {
  guest: {
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, nationality: true, documentType: true, documentNumber: true, birthDate: true },
  },
  room: { select: { id: true, number: true, type: true } },
  depositPaymentType: { select: { id: true, name: true } },
  depositConfirmedBy: { select: { name: true } },
  companions: { orderBy: { id: 'asc' } },
} satisfies Prisma.ReservationInclude;

export interface BookingInput {
  hotelId: number;
  guestId: number;
  roomId: number;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  source: ReservationSource;
  pricePerNight?: number;
  notes?: string;
  locale?: string;
  createdById?: number;
  deposit?: { percent: Prisma.Decimal; reference?: string; paymentTypeId?: number | null };
  companions?: CompanionDto[];
}

function generateCode() {
  return `R${randomBytes(4).toString('hex').toUpperCase()}`;
}

function overlapWhere(checkIn: Date, checkOut: Date, excludeId?: number): Prisma.ReservationWhereInput {
  return {
    status: { in: ACTIVE_STATUSES },
    checkIn: { lt: checkOut },
    checkOut: { gt: checkIn },
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folio: FolioService,
    private readonly mail: MailService,
  ) {}

  findAll(query: ReservationQueryDto, user: JwtPayload) {
    const q = query.q?.trim();
    const where: Prisma.ReservationWhereInput = {
      hotelId: resolveHotelScope(user, query.hotelId),
      status: query.status,
      guestId: query.guestId,
      ...(query.from ? { checkOut: { gt: parseDate(query.from) } } : {}),
      ...(query.to ? { checkIn: { lt: addDays(parseDate(query.to), 1) } } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q } },
              { guest: { firstName: { contains: q } } },
              { guest: { lastName: { contains: q } } },
            ],
          }
        : {}),
    };
    return this.prisma.reservation.findMany({
      where,
      include: reservationInclude,
      orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
      take: 500,
    });
  }

  async findOne(id: number, user: JwtPayload) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id }, include: reservationInclude });
    if (!reservation || !canAccessHotel(user, reservation.hotelId)) {
      throw new NotFoundException('Reserva nao encontrada');
    }
    return reservation;
  }

  availability(query: AvailabilityQueryDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    if (!hotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    const checkIn = parseDate(query.checkIn);
    const checkOut = parseDate(query.checkOut);
    assertStayRange(checkIn, checkOut);
    return this.findAvailableRooms(hotelId, checkIn, checkOut, query.guests ?? 1, undefined, query.excludeReservationId);
  }

  findAvailableRooms(hotelId: number, checkIn: Date, checkOut: Date, guests: number, type?: string, excludeId?: number, withImages = false) {
    return this.prisma.room.findMany({
      include: withImages ? { images: { select: { file: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } : undefined,
      where: {
        hotelId,
        type,
        status: { not: RoomStatus.MAINTENANCE },
        capacity: { gte: guests },
        reservations: { none: overlapWhere(checkIn, checkOut, excludeId) },
      },
      orderBy: [{ pricePerNight: 'asc' }, { number: 'asc' }],
    });
  }

  async create(dto: CreateReservationDto, user: JwtPayload) {
    const guest = await this.prisma.guest.findUnique({ where: { id: dto.guestId } });
    if (!guest || !canAccessHotel(user, guest.hotelId)) {
      throw new NotFoundException('Hospede nao encontrado');
    }
    const checkIn = parseDate(dto.checkIn);
    if (checkIn < todayUtc()) {
      throw new BadRequestException('Nao e possivel criar reservas com entrada no passado');
    }
    return this.book({
      hotelId: guest.hotelId,
      guestId: guest.id,
      roomId: dto.roomId,
      checkIn,
      checkOut: parseDate(dto.checkOut),
      adults: dto.adults ?? 1,
      children: dto.children ?? 0,
      source: dto.source ?? ReservationSource.DESK,
      pricePerNight: dto.pricePerNight,
      notes: dto.notes,
      createdById: user.sub,
    });
  }

  async book(input: BookingInput) {
    const nights = assertStayRange(input.checkIn, input.checkOut);
    return this.prisma.$transaction(async (tx) => {
      const room = await this.lockRoom(tx, input.roomId, input.hotelId);
      this.assertCapacity(room.capacity, input.adults, input.children);
      await this.assertRoomFree(tx, room.id, input.checkIn, input.checkOut);

      const pricePerNight = new Prisma.Decimal(input.pricePerNight ?? room.pricePerNight);
      const totalAmount = pricePerNight.mul(nights);
      const deposit = input.deposit
        ? {
            depositAmount: toMoney(totalAmount.mul(input.deposit.percent).div(100)),
            depositReference: input.deposit.reference,
            depositPaymentTypeId: input.deposit.paymentTypeId ?? null,
          }
        : {};
      return tx.reservation.create({
        data: {
          code: generateCode(),
          hotelId: input.hotelId,
          guestId: input.guestId,
          roomId: room.id,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          adults: input.adults,
          children: input.children,
          source: input.source,
          pricePerNight,
          totalAmount,
          notes: input.notes,
          locale: input.locale,
          createdById: input.createdById,
          ...deposit,
          ...(input.companions?.length ? { companions: { create: input.companions.map(companionData) } } : {}),
        },
        include: reservationInclude,
      });
    });
  }

  async update(id: number, dto: UpdateReservationDto, user: JwtPayload) {
    const current = await this.findOne(id, user);
    const checkedIn = current.status === ReservationStatus.CHECKED_IN;
    if (!checkedIn && !EDITABLE_STATUSES.includes(current.status)) {
      throw new ConflictException('Esta reserva ja nao pode ser alterada');
    }
    if (checkedIn && (dto.checkIn || dto.roomId)) {
      throw new ConflictException('Com o hospede em casa so e possivel alterar a saida, ocupantes, preco e notas');
    }

    const checkIn = dto.checkIn ? parseDate(dto.checkIn) : current.checkIn;
    const checkOut = dto.checkOut ? parseDate(dto.checkOut) : current.checkOut;
    const nights = assertStayRange(checkIn, checkOut);
    const adults = dto.adults ?? current.adults;
    const children = dto.children ?? current.children;
    const roomId = dto.roomId ?? current.roomId;

    return this.prisma.$transaction(async (tx) => {
      const room = await this.lockRoom(tx, roomId, current.hotelId);
      this.assertCapacity(room.capacity, adults, children);
      await this.assertRoomFree(tx, room.id, checkIn, checkOut, id);

      const pricePerNight =
        dto.pricePerNight !== undefined
          ? new Prisma.Decimal(dto.pricePerNight)
          : dto.roomId && dto.roomId !== current.roomId
            ? room.pricePerNight
            : current.pricePerNight;

      const updated = await tx.reservation.update({
        where: { id },
        data: {
          roomId,
          checkIn,
          checkOut,
          adults,
          children,
          notes: dto.notes ?? current.notes,
          pricePerNight,
          totalAmount: new Prisma.Decimal(pricePerNight).mul(nights),
        },
        include: reservationInclude,
      });
      if (checkedIn) {
        await this.folio.syncAccommodationCharge(tx, updated, user.sub);
      }
      return updated;
    });
  }

  async addCompanion(id: number, dto: CompanionDto, user: JwtPayload) {
    const reservation = await this.findOne(id, user);
    if (reservation.companions.length >= reservation.adults + reservation.children - 1) {
      throw new BadRequestException(`A reserva e para ${reservation.adults + reservation.children} pessoas: o titular e ${reservation.companions.length} acompanhante(s) ja estao registados`);
    }
    await this.prisma.reservationCompanion.create({ data: { ...companionData(dto), reservationId: id } });
    return this.findOne(id, user);
  }

  async updateCompanion(id: number, companionId: number, dto: CompanionDto, user: JwtPayload) {
    const reservation = await this.findOne(id, user);
    if (!reservation.companions.some((companion) => companion.id === companionId)) {
      throw new NotFoundException('Acompanhante nao encontrado');
    }
    await this.prisma.reservationCompanion.update({ where: { id: companionId }, data: companionData(dto) });
    return this.findOne(id, user);
  }

  async removeCompanion(id: number, companionId: number, user: JwtPayload) {
    const reservation = await this.findOne(id, user);
    if (!reservation.companions.some((companion) => companion.id === companionId)) {
      throw new NotFoundException('Acompanhante nao encontrado');
    }
    await this.prisma.reservationCompanion.delete({ where: { id: companionId } });
    return this.findOne(id, user);
  }

  async confirm(id: number, user: JwtPayload) {
    await this.findOne(id, user);
    const reservation = await this.transition(id, [ReservationStatus.PENDING], { status: ReservationStatus.CONFIRMED });
    if (reservation.guest.email) {
      const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: reservation.hotelId } });
      const content = bookingConfirmedEmail(hotel, {
        code: reservation.code,
        guestName: `${reservation.guest.firstName} ${reservation.guest.lastName}`,
        roomType: reservation.room.type,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        adults: reservation.adults,
        children: reservation.children,
        totalAmount: reservation.totalAmount,
      }, mailLang(reservation.locale));
      this.mail.queue({
        hotelId: hotel.id,
        kind: 'BOOKING_CONFIRMED',
        to: reservation.guest.email,
        replyTo: hotel.email,
        relatedId: reservation.id,
        ...content,
      });
    }
    return reservation;
  }

  async cancel(id: number, user: JwtPayload) {
    await this.findOne(id, user);
    return this.transition(id, EDITABLE_STATUSES, { status: ReservationStatus.CANCELLED, cancelledAt: new Date() });
  }

  async noShow(id: number, user: JwtPayload) {
    const reservation = await this.findOne(id, user);
    if (reservation.checkIn > todayUtc()) {
      throw new ConflictException('So e possivel marcar no-show a partir do dia de entrada');
    }
    return this.transition(id, EDITABLE_STATUSES, { status: ReservationStatus.NO_SHOW });
  }

  async checkIn(id: number, user: JwtPayload) {
    const reservation = await this.findOne(id, user);
    const today = todayUtc();
    if (reservation.checkIn > today) {
      throw new ConflictException('O check-in so pode ser feito a partir do dia de entrada');
    }
    if (reservation.checkOut <= today) {
      throw new ConflictException('A data de saida desta reserva ja passou');
    }

    return this.prisma.$transaction(async (tx) => {
      const room = await this.lockRoom(tx, reservation.roomId, reservation.hotelId);
      if (room.status === RoomStatus.OCCUPIED || room.status === RoomStatus.MAINTENANCE) {
        throw new ConflictException(`O quarto ${room.number} nao esta pronto (${room.status})`);
      }
      const updated = await this.transition(
        id,
        EDITABLE_STATUSES,
        { status: ReservationStatus.CHECKED_IN, checkedInAt: new Date() },
        tx,
      );
      await tx.room.update({ where: { id: room.id }, data: { status: RoomStatus.OCCUPIED } });
      await this.folio.syncAccommodationCharge(tx, updated, user.sub);
      return updated;
    });
  }

  async checkOut(id: number, user: JwtPayload) {
    const reservation = await this.findOne(id, user);
    return this.prisma.$transaction(async (tx) => {
      await this.folio.syncAccommodationCharge(tx, reservation, user.sub);
      const balance = await this.folio.balance(tx, reservation.id);
      if (balance.greaterThan(0)) {
        throw new ConflictException(`A conta do hospede tem ${balance.toFixed(2)} por pagar`);
      }
      const updated = await this.transition(
        id,
        [ReservationStatus.CHECKED_IN],
        { status: ReservationStatus.CHECKED_OUT, checkedOutAt: new Date() },
        tx,
      );
      await tx.room.update({ where: { id: reservation.roomId }, data: { status: RoomStatus.CLEANING } });
      return updated;
    });
  }

  private async transition(
    id: number,
    from: ReservationStatus[],
    data: Prisma.ReservationUpdateManyMutationInput,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const { count } = await tx.reservation.updateMany({ where: { id, status: { in: from } }, data });
    if (!count) {
      throw new ConflictException('O estado atual da reserva nao permite esta operacao');
    }
    return tx.reservation.findUniqueOrThrow({ where: { id }, include: reservationInclude });
  }

  private async lockRoom(tx: Prisma.TransactionClient, roomId: number, hotelId: number) {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM rooms WHERE id = ${roomId} AND hotelId = ${hotelId} FOR UPDATE`;
    if (!locked.length) {
      throw new NotFoundException('Quarto nao encontrado neste hotel');
    }
    return tx.room.findUniqueOrThrow({ where: { id: roomId } });
  }

  private assertCapacity(capacity: number, adults: number, children: number) {
    if (adults + children > capacity) {
      throw new BadRequestException(`O quarto so tem capacidade para ${capacity} pessoas`);
    }
  }

  private async assertRoomFree(
    tx: Prisma.TransactionClient,
    roomId: number,
    checkIn: Date,
    checkOut: Date,
    excludeId?: number,
  ) {
    const conflict = await tx.reservation.findFirst({
      where: { roomId, ...overlapWhere(checkIn, checkOut, excludeId) },
      select: { code: true },
    });
    if (conflict) {
      throw new ConflictException(`O quarto ja esta reservado nesse periodo (reserva ${conflict.code})`);
    }
  }
}

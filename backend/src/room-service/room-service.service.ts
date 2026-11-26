import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ChargeType, OrderStatus, Outlet, Prisma, ReservationStatus, RoomServiceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { localParts } from '../at/at-format';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { isManagerRole } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney, toMoney } from '../common/money';
import { PosService } from '../pos/pos.service';
import { PrismaService } from '../prisma/prisma.service';

const HOURS = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const PAIRING_MINUTES = 10;
const ACTIVE = [RoomServiceStatus.PENDING, RoomServiceStatus.ACCEPTED, RoomServiceStatus.ON_THE_WAY];

export class PairDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class RoomDeviceDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsInt()
  roomId: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class UpdateRoomDeviceDto {
  @IsOptional()
  @IsInt()
  roomId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class RoomServiceSettingsDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsOptional()
  @IsBoolean()
  autoAccept?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @Matches(HOURS, { message: 'Horario invalido: usa HH:MM-HH:MM' })
  restaurantHours?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @Matches(HOURS, { message: 'Horario invalido: usa HH:MM-HH:MM' })
  barHours?: string | null;
}

export class RoomOrderLineDto {
  @IsInt()
  productId: number;

  @IsInt()
  @Min(1)
  @Max(50)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class RoomOrderDto {
  @IsEnum(Outlet)
  outlet: Outlet;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => RoomOrderLineDto)
  items: RoomOrderLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class RejectDto {
  @IsString()
  @Length(3, 200)
  reason: string;
}

export class ReservationRoomServiceDto {
  @IsOptional()
  @IsBoolean()
  blocked?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  limit?: number | null;
}

export function hoursOpen(hours: string | null | undefined, now: string) {
  if (!hours) return true;
  const [from, to] = hours.split('-');
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const roomOrderInclude = {
  items: { orderBy: { createdAt: 'asc' }, select: { id: true, description: true, quantity: true, unitPrice: true, total: true, notes: true, sentAt: true, readyAt: true, voidedAt: true } },
  room: { select: { id: true, number: true } },
  reservation: { select: { id: true, code: true, guest: { select: { firstName: true, lastName: true } } } },
  roomDevice: { select: { id: true, name: true } },
} satisfies Prisma.OrderInclude;

type Device = Prisma.RoomDeviceGetPayload<{ include: { room: true; hotel: true } }>;

@Injectable()
export class RoomServiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pos: PosService,
    private readonly audit: AuditService,
  ) {}

  devices(query: HotelQueryDto, user: JwtPayload) {
    return this.prisma.roomDevice
      .findMany({
        where: { hotelId: resolveHotelScope(user, query.hotelId) },
        include: { room: { select: { id: true, number: true } } },
        orderBy: [{ room: { number: 'asc' } }, { id: 'asc' }],
      })
      .then((devices) => devices.map((device) => this.publicDevice(device)));
  }

  async createDevice({ hotelId, roomId, name }: RoomDeviceDto, user: JwtPayload) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    const scoped = resolveHotelScope(user, hotelId ?? room?.hotelId);
    if (!room || !scoped || room.hotelId !== scoped) {
      throw new BadRequestException('Quarto invalido');
    }
    const device = await this.prisma.roomDevice.create({
      data: { hotelId: room.hotelId, roomId, name: name?.trim() || null, ...(await this.newCode()) },
      include: { room: { select: { id: true, number: true } } },
    });
    return this.publicDevice(device);
  }

  async updateDevice(id: number, dto: UpdateRoomDeviceDto, user: JwtPayload) {
    const device = await this.findDevice(id, user);
    if (dto.roomId !== undefined) {
      const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
      if (!room || room.hotelId !== device.hotelId) {
        throw new BadRequestException('Quarto invalido');
      }
    }
    const revoke = dto.active === false ? { tokenHash: null, pairingCode: null, pairingExpiresAt: null } : {};
    const updated = await this.prisma.roomDevice.update({
      where: { id },
      data: { roomId: dto.roomId, name: dto.name === undefined ? undefined : dto.name.trim() || null, active: dto.active, ...revoke },
      include: { room: { select: { id: true, number: true } } },
    });
    return this.publicDevice(updated);
  }

  async pairingCode(id: number, user: JwtPayload) {
    const device = await this.findDevice(id, user);
    if (!device.active) {
      throw new ConflictException('Ativa o tablet antes de gerar um codigo');
    }
    const updated = await this.prisma.roomDevice.update({ where: { id }, data: await this.newCode(), include: { room: { select: { id: true, number: true } } } });
    return this.publicDevice(updated);
  }

  async removeDevice(id: number, user: JwtPayload) {
    await this.findDevice(id, user);
    await this.prisma.roomDevice.delete({ where: { id } });
  }

  async settings(query: HotelQueryDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    if (!hotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: hotelId } });
    return { autoAccept: hotel.roomServiceAutoAccept, restaurantHours: hotel.roomServiceRestaurantHours, barHours: hotel.roomServiceBarHours };
  }

  async updateSettings(dto: RoomServiceSettingsDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, dto.hotelId);
    if (!hotelId) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    await this.prisma.hotel.update({
      where: { id: hotelId },
      data: {
        roomServiceAutoAccept: dto.autoAccept,
        roomServiceRestaurantHours: dto.restaurantHours === undefined ? undefined : dto.restaurantHours || null,
        roomServiceBarHours: dto.barHours === undefined ? undefined : dto.barHours || null,
      },
    });
    return this.settings({ hotelId }, user);
  }

  async reservationSettings(id: number, dto: ReservationRoomServiceDto, user: JwtPayload) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation || !canAccessHotel(user, reservation.hotelId)) {
      throw new NotFoundException('Reserva nao encontrada');
    }
    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { roomServiceBlocked: dto.blocked, roomServiceLimit: dto.limit === undefined ? undefined : dto.limit },
      select: { id: true, roomServiceBlocked: true, roomServiceLimit: true },
    });
    await this.audit.log({
      hotelId: reservation.hotelId,
      userId: user.sub,
      action: 'ROOM_SERVICE_LIMITS',
      entity: 'reservation',
      entityId: id,
      summary: `Pedidos do quarto da reserva ${reservation.code}: ${updated.roomServiceBlocked ? 'bloqueados' : 'permitidos'}${updated.roomServiceLimit ? `, limite ${updated.roomServiceLimit.toFixed(2)}` : ''}`,
    });
    return updated;
  }

  async pair(dto: PairDto) {
    const device = await this.prisma.roomDevice.findFirst({
      where: { pairingCode: dto.code, active: true, pairingExpiresAt: { gt: new Date() } },
      include: { room: true, hotel: true },
    });
    if (!device) {
      throw new BadRequestException('Codigo invalido ou expirado');
    }
    const token = randomBytes(32).toString('base64url');
    await this.prisma.roomDevice.update({
      where: { id: device.id },
      data: { tokenHash: hashToken(token), pairingCode: null, pairingExpiresAt: null, pairedAt: new Date(), lastSeenAt: new Date() },
    });
    return { token, room: device.room.number, hotel: device.hotel.name };
  }

  async authenticate(token: string | undefined): Promise<Device> {
    if (!token) {
      throw new UnauthorizedException('Tablet nao associado');
    }
    const device = await this.prisma.roomDevice.findUnique({ where: { tokenHash: hashToken(token) }, include: { room: true, hotel: true } });
    if (!device || !device.active) {
      throw new UnauthorizedException('Tablet nao associado');
    }
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000) {
      await this.prisma.roomDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    }
    return device;
  }

  async session(device: Device) {
    const reservation = await this.currentStay(device);
    const now = localParts(new Date()).dateTime.slice(11, 16);
    const outlets = [
      { outlet: Outlet.RESTAURANT, hours: device.hotel.roomServiceRestaurantHours, open: hoursOpen(device.hotel.roomServiceRestaurantHours, now) },
      { outlet: Outlet.BAR, hours: device.hotel.roomServiceBarHours, open: hoursOpen(device.hotel.roomServiceBarHours, now) },
    ];
    const reason = !reservation ? 'NO_GUEST' : reservation.roomServiceBlocked ? 'BLOCKED' : null;
    return {
      hotel: { name: device.hotel.name, currency: device.hotel.currency },
      room: { number: device.room.number },
      guest: reservation ? { firstName: reservation.guest.firstName } : null,
      available: !reason,
      reason,
      outlets,
      limit: reservation?.roomServiceLimit ?? null,
      spent: reservation ? await this.spent(reservation.id) : new Prisma.Decimal(0),
    };
  }

  async menu(device: Device) {
    const products = await this.prisma.product.findMany({
      where: { hotelId: device.hotelId, active: true, sellable: true, roomService: true, optionGroups: { none: { active: true, required: true } } },
      select: {
        id: true,
        name: true,
        price: true,
        imageFile: true,
        categoryId: true,
        category: { select: { id: true, name: true, outlet: true, sortOrder: true } },
      },
      orderBy: { name: 'asc' },
    });
    return products.map(({ category, ...product }) => ({
      ...product,
      category: category ? { id: category.id, name: category.name, sortOrder: category.sortOrder } : null,
      outlets: category?.outlet ? [category.outlet] : [Outlet.RESTAURANT, Outlet.BAR],
    }));
  }

  async deviceOrders(device: Device) {
    const reservation = await this.currentStay(device);
    if (!reservation) return [];
    return this.prisma.order.findMany({
      where: { roomId: device.roomId, reservationId: reservation.id, roomServiceStatus: { not: null } },
      include: roomOrderInclude,
      orderBy: { openedAt: 'desc' },
      take: 50,
    });
  }

  async placeOrder(device: Device, dto: RoomOrderDto) {
    const reservation = await this.currentStay(device);
    if (!reservation) {
      throw new ConflictException('Este quarto nao tem hospede em casa');
    }
    if (reservation.roomServiceBlocked) {
      throw new ForbiddenException('Os pedidos do quarto estao bloqueados. Contacte a rececao');
    }
    const hours = dto.outlet === Outlet.BAR ? device.hotel.roomServiceBarHours : device.hotel.roomServiceRestaurantHours;
    if (!hoursOpen(hours, localParts(new Date()).dateTime.slice(11, 16))) {
      throw new ConflictException(`O servico de quartos deste ponto de venda funciona das ${hours!.replace('-', ' as ')}`);
    }
    const ids = [...new Set(dto.items.map((line) => line.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, hotelId: device.hotelId, active: true, sellable: true, roomService: true, optionGroups: { none: { active: true, required: true } } },
      include: { category: { select: { outlet: true } } },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    for (const line of dto.items) {
      const product = byId.get(line.productId);
      if (!product || (product.category?.outlet && product.category.outlet !== dto.outlet)) {
        throw new BadRequestException('Produto indisponivel no servico de quartos');
      }
    }
    const lines = dto.items.map((line) => {
      const product = byId.get(line.productId)!;
      return {
        productId: product.id,
        description: product.name,
        quantity: line.quantity,
        unitPrice: product.price,
        taxRateId: product.taxRateId,
        total: toMoney(new Prisma.Decimal(line.quantity).mul(product.price)),
        notes: line.notes?.trim() || null,
      };
    });
    const total = sumMoney(lines.map((line) => line.total));
    if (reservation.roomServiceLimit) {
      const spent = await this.spent(reservation.id);
      if (spent.add(total).greaterThan(reservation.roomServiceLimit)) {
        throw new ConflictException(
          `O pedido ultrapassa o limite de consumo do quarto (${toMoney(reservation.roomServiceLimit).toFixed(2)}; ja usado ${toMoney(spent).toFixed(2)}). Contacte a rececao`,
        );
      }
    }
    const order = await this.prisma.order.create({
      data: {
        hotelId: device.hotelId,
        outlet: dto.outlet,
        tableLabel: `Quarto ${device.room.number}`.slice(0, 30),
        roomId: device.roomId,
        roomDeviceId: device.id,
        reservationId: reservation.id,
        roomServiceStatus: RoomServiceStatus.PENDING,
        notes: dto.notes?.trim() || null,
        total,
        items: { createMany: { data: lines } },
      },
    });
    if (device.hotel.roomServiceAutoAccept) {
      const sentAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { roomServiceStatus: RoomServiceStatus.ACCEPTED, acceptedAt: sentAt } });
        await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { sentAt } });
      });
    }
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: roomOrderInclude });
  }

  roomOrders(query: HotelQueryDto, user: JwtPayload) {
    const since = new Date(Date.now() - 3 * 3600 * 1000);
    return this.prisma.order.findMany({
      where: {
        hotelId: resolveHotelScope(user, query.hotelId),
        OR: [{ roomServiceStatus: { in: ACTIVE } }, { roomServiceStatus: { in: [RoomServiceStatus.DELIVERED, RoomServiceStatus.REJECTED] }, closedAt: { gte: since } }],
      },
      include: roomOrderInclude,
      orderBy: { openedAt: 'asc' },
    });
  }

  async accept(id: number, user: JwtPayload) {
    await this.roomOrder(id, user, [RoomServiceStatus.PENDING]);
    const { count } = await this.prisma.order.updateMany({
      where: { id, status: OrderStatus.OPEN, roomServiceStatus: RoomServiceStatus.PENDING },
      data: { roomServiceStatus: RoomServiceStatus.ACCEPTED, acceptedAt: new Date() },
    });
    if (!count) {
      throw new ConflictException('Este pedido ja foi tratado');
    }
    const sent = await this.pos.send(id, user);
    return { ...sent, order: await this.prisma.order.findUniqueOrThrow({ where: { id }, include: roomOrderInclude }) };
  }

  async reject(id: number, reason: string, user: JwtPayload) {
    const order = await this.roomOrder(id, user, ACTIVE);
    if (order.roomServiceStatus !== RoomServiceStatus.PENDING && !isManagerRole(user.role)) {
      throw new ForbiddenException('So um gestor pode recusar um pedido ja aceite');
    }
    const { count } = await this.prisma.order.updateMany({
      where: { id, status: OrderStatus.OPEN, roomServiceStatus: order.roomServiceStatus },
      data: { roomServiceStatus: RoomServiceStatus.REJECTED, rejectReason: reason.trim(), status: OrderStatus.CANCELLED, closedAt: new Date() },
    });
    if (!count) {
      throw new ConflictException('Este pedido ja foi tratado');
    }
    await this.audit.log({
      hotelId: order.hotelId,
      userId: user.sub,
      action: 'ROOM_ORDER_REJECT',
      entity: 'order',
      entityId: id,
      summary: `${order.tableLabel}: pedido do quarto recusado (${order.total.toFixed(2)}) - ${reason.trim()}`,
    });
    return this.prisma.order.findUniqueOrThrow({ where: { id }, include: roomOrderInclude });
  }

  async dispatch(id: number, user: JwtPayload) {
    await this.roomOrder(id, user, [RoomServiceStatus.ACCEPTED]);
    const { count } = await this.prisma.order.updateMany({
      where: { id, status: OrderStatus.OPEN, roomServiceStatus: RoomServiceStatus.ACCEPTED },
      data: { roomServiceStatus: RoomServiceStatus.ON_THE_WAY, dispatchedAt: new Date() },
    });
    if (!count) {
      throw new ConflictException('Este pedido ja foi tratado');
    }
    return this.prisma.order.findUniqueOrThrow({ where: { id }, include: roomOrderInclude });
  }

  async deliver(id: number, user: JwtPayload) {
    const order = await this.roomOrder(id, user, [RoomServiceStatus.ACCEPTED, RoomServiceStatus.ON_THE_WAY]);
    if (!order.reservationId) {
      throw new ConflictException('O pedido nao tem estadia associada: abre-o no POS para o cobrar');
    }
    await this.pos.close(id, { mode: 'ROOM', reservationId: order.reservationId }, user);
    await this.prisma.order.update({ where: { id }, data: { roomServiceStatus: RoomServiceStatus.DELIVERED, deliveredAt: new Date(), dispatchedAt: order.dispatchedAt ?? new Date() } });
    return this.prisma.order.findUniqueOrThrow({ where: { id }, include: roomOrderInclude });
  }

  private async roomOrder(id: number, user: JwtPayload, statuses: RoomServiceStatus[]) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order || !canAccessHotel(user, order.hotelId) || !order.roomServiceStatus) {
      throw new NotFoundException('Pedido nao encontrado');
    }
    if (order.status !== OrderStatus.OPEN || !statuses.includes(order.roomServiceStatus)) {
      throw new ConflictException('Este pedido ja foi tratado');
    }
    return order;
  }

  private async currentStay(device: Device) {
    return this.prisma.reservation.findFirst({
      where: { hotelId: device.hotelId, roomId: device.roomId, status: ReservationStatus.CHECKED_IN },
      include: { guest: { select: { firstName: true } } },
      orderBy: { checkIn: 'desc' },
    });
  }

  private async spent(reservationId: number) {
    const [charges, open] = [
      await this.prisma.charge.aggregate({
        where: { reservationId, type: { in: [ChargeType.BAR, ChargeType.RESTAURANT] }, order: { roomServiceStatus: { not: null } } },
        _sum: { total: true },
      }),
      await this.prisma.order.aggregate({ where: { reservationId, status: OrderStatus.OPEN, roomServiceStatus: { in: ACTIVE } }, _sum: { total: true } }),
    ];
    return new Prisma.Decimal(charges._sum.total ?? 0).add(open._sum.total ?? 0);
  }

  private async newCode() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const clash = await this.prisma.roomDevice.count({ where: { pairingCode: code, pairingExpiresAt: { gt: new Date() } } });
      if (!clash) return { pairingCode: code, pairingExpiresAt: new Date(Date.now() + PAIRING_MINUTES * 60_000) };
    }
    throw new ConflictException('Nao foi possivel gerar um codigo. Tenta de novo');
  }

  private async findDevice(id: number, user: JwtPayload) {
    const device = await this.prisma.roomDevice.findUnique({ where: { id } });
    if (!device || !canAccessHotel(user, device.hotelId)) {
      throw new NotFoundException('Tablet nao encontrado');
    }
    return device;
  }

  private publicDevice(device: Prisma.RoomDeviceGetPayload<{ include: { room: { select: { id: true; number: true } } } }>) {
    const { tokenHash, pairingCode, pairingExpiresAt, ...rest } = device;
    const codeValid = Boolean(pairingCode && pairingExpiresAt && pairingExpiresAt > new Date());
    return { ...rest, paired: Boolean(tokenHash), pairingCode: codeValid ? pairingCode : null, pairingExpiresAt: codeValid ? pairingExpiresAt : null };
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventCardMovementType, PaymentMethod, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { FolioService } from '../billing/folio.service';
import { isManagerRole } from '../common/decorators/roles.decorator';
import { addDays, parseDate } from '../common/dates';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

const MAX_AMOUNT = 1_000_000;
const CARD_TYPE_NAME = 'Cartao Evento';

export class CardListQueryDto extends HotelQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class CardLookupDto extends HotelQueryDto {
  @IsString()
  @Length(1, 200)
  number: string;
}

export class CardMovementsQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  to?: string;
}

class MoneyDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_AMOUNT)
  amount: number;

  @IsInt()
  paymentTypeId: number;

  @IsOptional()
  @IsInt()
  cashSessionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @Length(8, 80)
  idempotencyKey?: string;
}

export class RegisterCardDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @Length(1, 200)
  number: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  holder?: string;

  @IsOptional()
  @IsInt()
  guestId?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  amount?: number;

  @IsOptional()
  @IsInt()
  paymentTypeId?: number;

  @IsOptional()
  @IsInt()
  cashSessionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @Length(8, 80)
  idempotencyKey?: string;
}

export class TopUpDto extends MoneyDto {}

export class CardActiveDto {
  @IsBoolean()
  active: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class CardGuestDto {
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  guestId: number | null;
}

export class CardTransferDto {
  @IsString()
  @Length(1, 200)
  toNumber: string;

  @IsOptional()
  @IsBoolean()
  block?: boolean;

  @IsString()
  @Length(3, 200)
  reason: string;
}

export class CardRefundDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_AMOUNT)
  amount: number;

  @IsString()
  @Length(3, 200)
  reason: string;

  @IsOptional()
  @IsInt()
  orderId?: number;
}

class DischargeItemDto {
  @IsInt()
  id: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  balance: number;
}

export class DischargeQueryDto extends HotelQueryDto {
  @IsOptional()
  @IsString()
  includeGuests?: string;
}

export class DischargeDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => DischargeItemDto)
  cards: DischargeItemDto[];

  @IsBoolean()
  refund: boolean;

  @IsOptional()
  @IsInt()
  paymentTypeId?: number;

  @IsOptional()
  @IsInt()
  cashSessionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsString()
  @Length(3, 200)
  reason: string;
}

export function cardNumber(raw: string) {
  const text = raw.trim();
  const track1 = /%[A-Z]?([0-9]{4,19})\^/.exec(text);
  if (track1) return track1[1];
  const track2 = /;([0-9]{4,19})[=?]/.exec(text);
  if (track2) return track2[1];
  const plain = text.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9-]{4,40}$/.test(plain)) {
    throw new BadRequestException('Numero de cartao invalido (4 a 40 letras ou algarismos)');
  }
  return plain;
}

const cardSelect = {
  id: true,
  hotelId: true,
  number: true,
  holder: true,
  guestId: true,
  balance: true,
  active: true,
  createdAt: true,
  guest: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.EventCardSelect;

const movementInclude = {
  createdBy: { select: { name: true } },
  loadPayment: { select: { method: true, paymentType: { select: { name: true } } } },
  card: { select: { number: true } },
} satisfies Prisma.EventCardMovementInclude;

@Injectable()
export class EventCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folio: FolioService,
    private readonly audit: AuditService,
  ) {}

  async list(query: CardListQueryDto, user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    const q = query.q?.trim();
    const cards = await this.prisma.eventCard.findMany({
      where: {
        hotelId,
        ...(q
          ? {
              OR: [
                { number: { contains: q.toUpperCase() } },
                { holder: { contains: q } },
                { guest: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }] } },
              ],
            }
          : {}),
      },
      select: { ...cardSelect, movements: { select: { createdAt: true }, orderBy: { id: 'desc' }, take: 1 } },
      orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
      take: 500,
    });
    return cards.map(({ movements, ...card }) => ({ ...card, lastMovementAt: movements[0]?.createdAt ?? null }));
  }

  async lookup(query: CardLookupDto, user: JwtPayload) {
    const hotelId = this.hotel(user, query.hotelId);
    const card = await this.prisma.eventCard.findUnique({ where: { hotelId_number: { hotelId, number: cardNumber(query.number) } }, select: cardSelect });
    if (!card) throw new NotFoundException('Cartao nao registado');
    return card;
  }

  async findOne(id: number, user: JwtPayload) {
    const card = await this.prisma.eventCard.findUnique({ where: { id }, select: cardSelect });
    if (!card || !canAccessHotel(user, card.hotelId)) throw new NotFoundException('Cartao nao encontrado');
    return card;
  }

  async movements(id: number, query: CardMovementsQueryDto, user: JwtPayload) {
    const card = await this.findOne(id, user);
    const from = query.from ? parseDate(query.from) : undefined;
    const to = query.to ? addDays(parseDate(query.to), 1) : undefined;
    const items = await this.prisma.eventCardMovement.findMany({
      where: { cardId: card.id, createdAt: { gte: from, lt: to } },
      include: movementInclude,
      orderBy: { id: 'desc' },
      take: 500,
    });
    const credit = items.filter((item) => item.amount.greaterThan(0)).reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
    const debit = items.filter((item) => item.amount.lessThan(0)).reduce((sum, item) => sum.add(item.amount.neg()), new Prisma.Decimal(0));
    return { card, items, credit, debit };
  }

  async guestStatement(guestId: number, user: JwtPayload) {
    const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
    if (!guest || !canAccessHotel(user, guest.hotelId)) throw new NotFoundException('Hospede nao encontrado');
    const [cards, items] = [
      await this.prisma.eventCard.findMany({ where: { guestId }, select: cardSelect }),
      await this.prisma.eventCardMovement.findMany({ where: { guestId }, include: movementInclude, orderBy: { id: 'desc' }, take: 500 }),
    ];
    const balance = items.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
    return { guest: { id: guest.id, firstName: guest.firstName, lastName: guest.lastName }, cards, items, balance };
  }

  async register(dto: RegisterCardDto, user: JwtPayload) {
    const hotelId = this.hotel(user, dto.hotelId);
    const number = cardNumber(dto.number);
    if (dto.guestId) await this.checkGuest(hotelId, dto.guestId);
    const amount = toMoney(dto.amount ?? 0);
    if (amount.greaterThan(0) && !dto.paymentTypeId) throw new BadRequestException('Escolha como foi pago o valor inicial');
    if (await this.prisma.eventCard.findUnique({ where: { hotelId_number: { hotelId, number } } })) {
      throw new ConflictException(`O cartao ${number} ja esta registado`);
    }
    await this.ensurePaymentType(hotelId);
    const card = await this.prisma.$transaction(async (tx) => {
      const created = await tx.eventCard.create({
        data: { hotelId, number, holder: dto.holder?.trim() || null, guestId: dto.guestId ?? null, createdById: user.sub },
      });
      if (amount.greaterThan(0)) {
        await this.load(tx, created.id, EventCardMovementType.LOAD, amount, dto, user);
      }
      await this.audit.log(
        { hotelId, userId: user.sub, action: 'CARD_REGISTER', entity: 'event_card', entityId: created.id, summary: `Cartao ${number} registado${amount.greaterThan(0) ? ` com ${amount.toFixed(2)}` : ''}` },
        tx,
      );
      return created;
    });
    return this.findOne(card.id, user);
  }

  async topUp(id: number, dto: TopUpDto, user: JwtPayload) {
    const card = await this.findOne(id, user);
    if (!card.active) throw new ConflictException('O cartao esta bloqueado');
    if (dto.idempotencyKey) {
      const done = await this.prisma.eventCardMovement.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (done) return { card: await this.findOne(id, user), movementId: done.id };
    }
    const movementId = await this.prisma.$transaction(async (tx) => {
      const movement = await this.load(tx, card.id, EventCardMovementType.TOPUP, toMoney(dto.amount), dto, user);
      await this.audit.log(
        { hotelId: card.hotelId, userId: user.sub, action: 'CARD_TOPUP', entity: 'event_card', entityId: card.id, summary: `Cartao ${card.number}: recarga de ${toMoney(dto.amount).toFixed(2)}` },
        tx,
      );
      return movement.id;
    });
    return { card: await this.findOne(id, user), movementId };
  }

  async setActive(id: number, dto: CardActiveDto, user: JwtPayload) {
    const card = await this.findOne(id, user);
    await this.prisma.eventCard.update({ where: { id }, data: { active: dto.active } });
    await this.audit.log({
      hotelId: card.hotelId,
      userId: user.sub,
      action: dto.active ? 'CARD_UNBLOCK' : 'CARD_BLOCK',
      entity: 'event_card',
      entityId: id,
      summary: `Cartao ${card.number} ${dto.active ? 'desbloqueado' : 'bloqueado'}${dto.reason ? `: ${dto.reason}` : ''}`,
    });
    return this.findOne(id, user);
  }

  async setGuest(id: number, dto: CardGuestDto, user: JwtPayload) {
    const card = await this.findOne(id, user);
    if (dto.guestId) await this.checkGuest(card.hotelId, dto.guestId);
    if ((dto.guestId ?? null) === card.guestId) return card;
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.eventCard.findUniqueOrThrow({ where: { id } });
      if (current.balance.greaterThan(0)) {
        await tx.eventCardMovement.create({
          data: { cardId: id, guestId: current.guestId, type: EventCardMovementType.GUEST_CHANGE, amount: current.balance.neg(), balanceAfter: current.balance, reason: 'Mudanca de titular', createdById: user.sub },
        });
        await tx.eventCardMovement.create({
          data: { cardId: id, guestId: dto.guestId, type: EventCardMovementType.GUEST_CHANGE, amount: current.balance, balanceAfter: current.balance, reason: 'Mudanca de titular', createdById: user.sub },
        });
      }
      await tx.eventCard.update({ where: { id }, data: { guestId: dto.guestId } });
      await this.audit.log(
        { hotelId: card.hotelId, userId: user.sub, action: 'CARD_GUEST', entity: 'event_card', entityId: id, summary: `Cartao ${card.number}: hospede ${dto.guestId ? `#${dto.guestId}` : 'retirado'}` },
        tx,
      );
    });
    return this.findOne(id, user);
  }

  async transfer(id: number, dto: CardTransferDto, user: JwtPayload) {
    const source = await this.findOne(id, user);
    const targetNumber = cardNumber(dto.toNumber);
    const target = await this.prisma.eventCard.findUnique({ where: { hotelId_number: { hotelId: source.hotelId, number: targetNumber } } });
    if (!target) throw new NotFoundException('O cartao de destino nao esta registado');
    if (target.id === source.id) throw new BadRequestException('Escolha outro cartao de destino');
    if (!target.active) throw new ConflictException('O cartao de destino esta bloqueado');
    if (target.guestId !== source.guestId && !(target.guestId === null && target.balance.isZero())) {
      throw new ConflictException('O cartao de destino pertence a outro hospede: o saldo so passa entre cartoes do mesmo hospede');
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.eventCard.findUniqueOrThrow({ where: { id: source.id } });
      if (!current.balance.greaterThan(0)) throw new ConflictException('O cartao nao tem saldo para transferir');
      const amount = current.balance;
      const reason = `${current.number} -> ${target.number}: ${dto.reason.trim()}`.slice(0, 200);
      await tx.eventCard.update({ where: { id: source.id }, data: { balance: 0, ...(dto.block ? { active: false } : {}) } });
      await tx.eventCardMovement.create({
        data: { cardId: source.id, guestId: current.guestId, type: EventCardMovementType.TRANSFER_OUT, amount: amount.neg(), balanceAfter: 0, reason, createdById: user.sub },
      });
      const updated = await tx.eventCard.update({ where: { id: target.id }, data: { balance: { increment: amount }, guestId: target.guestId ?? current.guestId } });
      await tx.eventCardMovement.create({
        data: { cardId: target.id, guestId: updated.guestId, type: EventCardMovementType.TRANSFER_IN, amount, balanceAfter: updated.balance, reason, createdById: user.sub },
      });
      await this.audit.log(
        { hotelId: source.hotelId, userId: user.sub, action: 'CARD_TRANSFER', entity: 'event_card', entityId: source.id, summary: `Saldo ${amount.toFixed(2)} passado ${reason}${dto.block ? ' (origem bloqueada)' : ''}` },
        tx,
      );
    });
    return { source: await this.findOne(source.id, user), target: await this.findOne(target.id, user) };
  }

  async refund(id: number, dto: CardRefundDto, user: JwtPayload) {
    if (!isManagerRole(user.role)) throw new ForbiddenException('So um gestor pode devolver valor ao cartao');
    const card = await this.findOne(id, user);
    const amount = toMoney(dto.amount);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.eventCard.update({ where: { id }, data: { balance: { increment: amount } } });
      await tx.eventCardMovement.create({
        data: { cardId: id, guestId: updated.guestId, type: EventCardMovementType.REFUND, amount, balanceAfter: updated.balance, orderId: dto.orderId ?? null, reason: dto.reason.trim(), createdById: user.sub },
      });
      await this.audit.log(
        { hotelId: card.hotelId, userId: user.sub, action: 'CARD_REFUND', entity: 'event_card', entityId: id, summary: `Cartao ${card.number}: devolvido ${amount.toFixed(2)} - ${dto.reason.trim()}` },
        tx,
      );
    });
    return this.findOne(id, user);
  }

  async dischargeBalances(query: DischargeQueryDto, user: JwtPayload) {
    const hotelId = this.hotel(user, query.hotelId);
    const includeGuests = query.includeGuests === 'true';
    const cards = await this.prisma.eventCard.findMany({ where: { hotelId, balance: { gt: 0 } }, select: cardSelect, orderBy: { number: 'asc' } });
    const listed = cards.filter((card) => includeGuests || !card.guestId);
    const left = cards.filter((card) => card.guestId && !includeGuests);
    return {
      cards: listed,
      total: listed.reduce((sum, card) => sum.add(card.balance), new Prisma.Decimal(0)),
      guestCardsLeft: left.length,
      guestBalanceLeft: left.reduce((sum, card) => sum.add(card.balance), new Prisma.Decimal(0)),
    };
  }

  async discharge(dto: DischargeDto, user: JwtPayload) {
    if (!isManagerRole(user.role)) throw new ForbiddenException('So um gestor pode descarregar saldos');
    const hotelId = this.hotel(user, dto.hotelId);
    if (dto.refund && !dto.paymentTypeId) throw new BadRequestException('Escolha como e devolvido o dinheiro');
    const ids = [...new Set(dto.cards.map((item) => item.id))];
    if (ids.length !== dto.cards.length) throw new BadRequestException('Cada cartao so pode aparecer uma vez');
    return this.prisma.$transaction(
      async (tx) => {
        const cards = await tx.eventCard.findMany({ where: { id: { in: ids }, hotelId } });
        if (cards.length !== ids.length) throw new BadRequestException('Cartao invalido para este hotel');
        for (const item of dto.cards) {
          const card = cards.find((entry) => entry.id === item.id)!;
          if (!card.balance.equals(toMoney(item.balance))) {
            throw new ConflictException(`O saldo do cartao ${card.number} mudou entretanto: atualize a lista`);
          }
          if (!card.balance.greaterThan(0)) throw new ConflictException(`O cartao ${card.number} nao tem saldo`);
        }
        const total = cards.reduce((sum, card) => sum.add(card.balance), new Prisma.Decimal(0));
        let cashSessionId: number | null = null;
        if (dto.refund) {
          const payment = await this.folio.recordPayment(
            tx,
            { hotelId, amount: total.neg(), paymentTypeId: dto.paymentTypeId, cashSessionId: dto.cashSessionId, reference: dto.reference || 'estorno', notes: `Descarga de ${cards.length} cartao(oes) evento`, createdById: user.sub },
            user,
          );
          cashSessionId = payment.cashSessionId;
        }
        const discharge = await tx.eventCardDischarge.create({
          data: {
            hotelId,
            refunded: dto.refund,
            paymentTypeId: dto.refund ? dto.paymentTypeId : null,
            cashSessionId,
            reference: dto.reference?.trim() || null,
            reason: dto.reason.trim(),
            total,
            cards: cards.length,
            createdById: user.sub,
          },
        });
        for (const card of cards) {
          const { count } = await tx.eventCard.updateMany({ where: { id: card.id, balance: card.balance }, data: { balance: 0 } });
          if (!count) throw new ConflictException(`O saldo do cartao ${card.number} mudou entretanto: atualize a lista`);
          await tx.eventCardMovement.create({
            data: { cardId: card.id, guestId: card.guestId, type: EventCardMovementType.DISCHARGE, amount: card.balance.neg(), balanceAfter: 0, dischargeId: discharge.id, cashSessionId, reason: dto.reason.trim(), createdById: user.sub },
          });
        }
        await this.audit.log(
          {
            hotelId,
            userId: user.sub,
            action: 'CARD_DISCHARGE',
            entity: 'event_card_discharge',
            entityId: discharge.id,
            summary: `Descarga de ${cards.length} cartao(oes): ${total.toFixed(2)} ${dto.refund ? 'devolvidos' : 'retirados sem devolucao'} - ${dto.reason.trim()}`,
          },
          tx,
        );
        return discharge;
      },
      { timeout: 60_000 },
    );
  }

  async ensurePaymentType(hotelId: number) {
    const existing = await this.prisma.paymentType.findFirst({ where: { hotelId, isEventCard: true } });
    if (existing) return existing;
    return this.prisma.paymentType.create({ data: { hotelId, name: CARD_TYPE_NAME, kind: PaymentMethod.OTHER, isEventCard: true, sortOrder: 99 } });
  }

  async charge(tx: Prisma.TransactionClient, input: { hotelId: number; number: string; amount: Prisma.Decimal; paymentId: number; orderId?: number; userId: number }) {
    const number = cardNumber(input.number);
    const card = await tx.eventCard.findUnique({ where: { hotelId_number: { hotelId: input.hotelId, number } } });
    if (!card) throw new NotFoundException(`O cartao ${number} nao esta registado`);
    if (!card.active) throw new ConflictException(`O cartao ${number} esta bloqueado`);
    const { count } = await tx.eventCard.updateMany({ where: { id: card.id, balance: { gte: input.amount } }, data: { balance: { decrement: input.amount } } });
    if (!count) throw new ConflictException(`Saldo insuficiente no cartao ${number}: disponivel ${card.balance.toFixed(2)}`);
    const updated = await tx.eventCard.findUniqueOrThrow({ where: { id: card.id } });
    await tx.eventCardMovement.create({
      data: {
        cardId: card.id,
        guestId: card.guestId,
        type: EventCardMovementType.PAYMENT,
        amount: input.amount.neg(),
        balanceAfter: updated.balance,
        usePaymentId: input.paymentId,
        orderId: input.orderId ?? null,
        reason: input.orderId ? `Pedido #${input.orderId}` : null,
        createdById: input.userId,
      },
    });
    return updated;
  }

  private async load(tx: Prisma.TransactionClient, cardId: number, type: EventCardMovementType, amount: Prisma.Decimal, money: { paymentTypeId?: number; cashSessionId?: number; reference?: string; idempotencyKey?: string }, user: JwtPayload) {
    const card = await tx.eventCard.findUniqueOrThrow({ where: { id: cardId } });
    const paymentType = money.paymentTypeId ? await tx.paymentType.findUnique({ where: { id: money.paymentTypeId } }) : null;
    if (paymentType?.isEventCard) throw new BadRequestException('Um cartao nao se carrega com outro cartao: escolha outro tipo de pagamento');
    const payment = await this.folio.recordPayment(
      tx,
      { hotelId: card.hotelId, amount, paymentTypeId: money.paymentTypeId, cashSessionId: money.cashSessionId, reference: money.reference, notes: `${type === EventCardMovementType.LOAD ? 'Carregamento' : 'Recarga'} do cartao ${card.number}`, createdById: user.sub },
      user,
    );
    const updated = await tx.eventCard.update({ where: { id: cardId }, data: { balance: { increment: amount } } });
    return tx.eventCardMovement.create({
      data: {
        cardId,
        guestId: updated.guestId,
        type,
        amount,
        balanceAfter: updated.balance,
        loadPaymentId: payment.id,
        cashSessionId: payment.cashSessionId,
        idempotencyKey: money.idempotencyKey ?? null,
        createdById: user.sub,
      },
    });
  }

  private async checkGuest(hotelId: number, guestId: number) {
    const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
    if (!guest || guest.hotelId !== hotelId) throw new BadRequestException('Hospede invalido para este hotel');
  }

  private hotel(user: JwtPayload, hotelId?: number) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) throw new BadRequestException('hotelId e obrigatorio');
    return scoped;
  }
}

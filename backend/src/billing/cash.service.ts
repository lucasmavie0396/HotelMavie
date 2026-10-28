import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CashMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

export class CreateRegisterDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @MaxLength(60)
  name: string;
}

export class OpenSessionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingAmount: number;
}

export class CloseSessionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CashMovementDto {
  @IsEnum(CashMovementType)
  type: CashMovementType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsString()
  @MaxLength(200)
  description: string;
}

export class RegisterQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hotelId?: number;
}

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  findRegisters(query: RegisterQueryDto, user: JwtPayload) {
    return this.prisma.cashRegister.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId), active: true },
      include: {
        sessions: {
          where: { closedAt: null },
          include: { openedBy: { select: { id: true, name: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  createRegister({ hotelId, name }: CreateRegisterDto, user: JwtPayload) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    return this.prisma.cashRegister.create({ data: { hotelId: scoped, name } });
  }

  async open(registerId: number, dto: OpenSessionDto, user: JwtPayload) {
    const register = await this.prisma.cashRegister.findUnique({ where: { id: registerId } });
    if (!register || !canAccessHotel(user, register.hotelId)) {
      throw new NotFoundException('Caixa nao encontrada');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cash_registers WHERE id = ${registerId} FOR UPDATE`;
      const open = await tx.cashSession.findFirst({ where: { registerId, closedAt: null } });
      if (open) {
        throw new ConflictException('Esta caixa ja esta aberta');
      }
      return tx.cashSession.create({
        data: { registerId, openingAmount: toMoney(dto.openingAmount), openedById: user.sub },
      });
    });
  }

  async sessions(registerId: number, user: JwtPayload) {
    const register = await this.prisma.cashRegister.findUnique({ where: { id: registerId } });
    if (!register || !canAccessHotel(user, register.hotelId)) {
      throw new NotFoundException('Caixa nao encontrada');
    }
    return this.prisma.cashSession.findMany({
      where: { registerId },
      include: { openedBy: { select: { name: true } }, closedBy: { select: { name: true } } },
      orderBy: { openedAt: 'desc' },
      take: 50,
    });
  }

  async session(id: number, user: JwtPayload) {
    const session = await this.prisma.cashSession.findUnique({
      where: { id },
      include: {
        register: true,
        openedBy: { select: { name: true } },
        closedBy: { select: { name: true } },
        payments: {
          include: { reservation: { select: { id: true, code: true } } },
          orderBy: { createdAt: 'asc' },
        },
        movements: { include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session || !canAccessHotel(user, session.register.hotelId)) {
      throw new NotFoundException('Sessao de caixa nao encontrada');
    }
    return { ...session, expected: this.expected(session) };
  }

  async addMovement(sessionId: number, dto: CashMovementDto, user: JwtPayload) {
    await this.openSession(sessionId, user);
    return this.prisma.cashMovement.create({
      data: { sessionId, type: dto.type, amount: toMoney(dto.amount), description: dto.description, createdById: user.sub },
    });
  }

  async close(sessionId: number, dto: CloseSessionDto, user: JwtPayload) {
    await this.openSession(sessionId, user);
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.cashSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { payments: true, movements: true },
      });
      const expected = this.expected(session);
      const counted = toMoney(dto.countedAmount);
      const { count } = await tx.cashSession.updateMany({
        where: { id: sessionId, closedAt: null },
        data: {
          closedAt: new Date(),
          closedById: user.sub,
          expectedAmount: expected,
          countedAmount: counted,
          difference: counted.sub(expected),
          notes: dto.notes,
        },
      });
      if (!count) {
        throw new ConflictException('Esta caixa ja foi fechada');
      }
      return tx.cashSession.findUniqueOrThrow({ where: { id: sessionId } });
    });
  }

  private async openSession(sessionId: number, user: JwtPayload) {
    const session = await this.prisma.cashSession.findUnique({ where: { id: sessionId }, include: { register: true } });
    if (!session || !canAccessHotel(user, session.register.hotelId)) {
      throw new NotFoundException('Sessao de caixa nao encontrada');
    }
    if (session.closedAt) {
      throw new ConflictException('Esta caixa ja foi fechada');
    }
    return session;
  }

  private expected(session: {
    openingAmount: { toString(): string };
    payments: { amount: { toString(): string } }[];
    movements: { type: CashMovementType; amount: { toString(): string } }[];
  }) {
    const payments = sumMoney(session.payments.map((payment) => payment.amount.toString()));
    const inflows = sumMoney(session.movements.filter((m) => m.type === CashMovementType.IN).map((m) => m.amount.toString()));
    const outflows = sumMoney(session.movements.filter((m) => m.type === CashMovementType.OUT).map((m) => m.amount.toString()));
    return toMoney(session.openingAmount.toString()).add(payments).add(inflows).sub(outflows);
  }
}

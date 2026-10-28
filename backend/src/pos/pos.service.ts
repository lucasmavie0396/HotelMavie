import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ChargeType,
  InvoiceType,
  OrderStatus,
  Outlet,
  PaymentMethod,
  Prisma,
  ReservationStatus,
  StockMovementType,
  UserRole,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { FolioService } from '../billing/folio.service';
import { InvoicesService } from '../billing/invoices.service';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';

export class OpenOrderDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsEnum(Outlet)
  outlet: Outlet;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  tableLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class OrderItemDto {
  @IsInt()
  productId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class OrderPaymentDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsInt()
  cashSessionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export class CloseOrderDto {
  @IsIn(['ROOM', 'PAY'])
  mode: 'ROOM' | 'PAY';

  @IsOptional()
  @IsInt()
  reservationId?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderPaymentDto)
  payments?: OrderPaymentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customerTaxId?: string;
}

export class OrderQueryDto extends HotelQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(Outlet)
  outlet?: Outlet;
}

const orderInclude = {
  items: { orderBy: { createdAt: 'asc' } },
  reservation: { select: { id: true, code: true, room: { select: { number: true } } } },
  openedBy: { select: { name: true } },
  payments: { select: { id: true, method: true, amount: true, invoiceId: true } },
  charges: { select: { id: true, invoice: { select: { id: true, fullNumber: true } } } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folio: FolioService,
    private readonly invoices: InvoicesService,
    private readonly stock: StockService,
  ) {}

  findAll(query: OrderQueryDto, user: JwtPayload) {
    return this.prisma.order.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId), status: query.status, outlet: query.outlet },
      include: orderInclude,
      orderBy: { openedAt: 'desc' },
      take: 200,
    });
  }

  async findOne(id: number, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order || !canAccessHotel(user, order.hotelId)) {
      throw new NotFoundException('Pedido nao encontrado');
    }
    return order;
  }

  open({ hotelId, ...data }: OpenOrderDto, user: JwtPayload) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    return this.prisma.order.create({ data: { ...data, hotelId: scoped, openedById: user.sub }, include: orderInclude });
  }

  async addItem(orderId: number, dto: OrderItemDto, user: JwtPayload) {
    const order = await this.openOrder(orderId, user);
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.hotelId !== order.hotelId || !product.active || !product.sellable) {
      throw new BadRequestException('Produto indisponivel');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.orderItem.create({
        data: {
          orderId,
          productId: product.id,
          description: product.name,
          quantity: dto.quantity,
          unitPrice: product.price,
          taxRateId: product.taxRateId,
          total: toMoney(new Prisma.Decimal(dto.quantity).mul(product.price)),
          notes: dto.notes,
        },
      });
      return this.recalculate(tx, orderId);
    });
  }

  async removeItem(orderId: number, itemId: number, user: JwtPayload) {
    await this.openOrder(orderId, user);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.orderItem.deleteMany({ where: { id: itemId, orderId } });
      if (!count) {
        throw new NotFoundException('Linha nao encontrada');
      }
      return this.recalculate(tx, orderId);
    });
  }

  async cancel(orderId: number, user: JwtPayload) {
    const order = await this.openOrder(orderId, user);
    if (order.items.length && user.role === UserRole.RECEPTION) {
      throw new ForbiddenException('So um gestor pode anular pedidos com produtos');
    }
    await this.prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED, closedAt: new Date() } });
    return this.findOne(orderId, user);
  }

  async close(orderId: number, dto: CloseOrderDto, user: JwtPayload) {
    const order = await this.openOrder(orderId, user);
    if (!order.items.length) {
      throw new BadRequestException('O pedido nao tem produtos');
    }
    const chargeType = order.outlet === Outlet.BAR ? ChargeType.BAR : ChargeType.RESTAURANT;
    const label = order.outlet === Outlet.BAR ? 'Bar' : 'Restaurante';

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.OPEN },
        data: { status: OrderStatus.CLOSED, closedAt: new Date() },
      });
      if (!count) {
        throw new ConflictException('Este pedido ja foi fechado');
      }

      let reservationId: number | null = null;
      if (dto.mode === 'ROOM') {
        const reservation = dto.reservationId ? await tx.reservation.findUnique({ where: { id: dto.reservationId } }) : null;
        if (!reservation || reservation.hotelId !== order.hotelId || reservation.status !== ReservationStatus.CHECKED_IN) {
          throw new BadRequestException('Escolhe um hospede em casa para lancar no quarto');
        }
        reservationId = reservation.id;
        await tx.order.update({ where: { id: orderId }, data: { reservationId } });
      }

      const charges = [];
      for (const item of order.items) {
        charges.push(
          await this.folio.createCharge(tx, {
            hotelId: order.hotelId,
            reservationId,
            type: chargeType,
            description: `${label}${order.tableLabel ? ` ${order.tableLabel}` : ''}: ${item.description}`,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRateId: item.taxRateId,
            sourceRef: `order:${order.id}`,
            createdById: user.sub,
          }),
        );
      }
      await tx.charge.updateMany({ where: { id: { in: charges.map((c) => c.id) } }, data: { orderId } });

      if (dto.mode === 'PAY') {
        const payments = dto.payments ?? [];
        const paid = sumMoney(payments.map((p) => p.amount));
        if (!paid.equals(toMoney(order.total))) {
          throw new BadRequestException(`Os pagamentos (${paid.toFixed(2)}) tem de igualar o total (${toMoney(order.total).toFixed(2)})`);
        }
        const withRates = await tx.charge.findMany({ where: { id: { in: charges.map((c) => c.id) } }, include: { taxRateRef: true } });
        const invoice = await this.invoices.issue(tx, {
          hotelId: order.hotelId,
          type: InvoiceType.INVOICE_RECEIPT,
          charges: withRates,
          customerName: dto.customerName,
          customerTaxId: dto.customerTaxId,
          createdById: user.sub,
        });
        for (const payment of payments) {
          const created = await this.folio.recordPayment(
            tx,
            {
              hotelId: order.hotelId,
              invoiceId: invoice.id,
              amount: payment.amount,
              method: payment.method,
              cashSessionId: payment.cashSessionId,
              reference: payment.reference,
              createdById: user.sub,
            },
            user,
          );
          await tx.payment.update({ where: { id: created.id }, data: { orderId } });
        }
      }

      await this.deductStock(tx, order.hotelId, order.id, order.items, user.sub);
    });
    return this.findOne(orderId, user);
  }

  private async deductStock(
    tx: Prisma.TransactionClient,
    hotelId: number,
    orderId: number,
    items: { productId: number; quantity: Prisma.Decimal }[],
    createdById: number,
  ) {
    const tracked = await tx.product.findMany({
      where: { id: { in: items.map((item) => item.productId) }, trackStock: true },
      select: { id: true },
    });
    if (!tracked.length) {
      return;
    }
    const trackedIds = new Set(tracked.map((product) => product.id));
    const warehouse = await this.stock.defaultWarehouse(tx, hotelId);
    for (const item of items.filter((i) => trackedIds.has(i.productId))) {
      await this.stock.move(tx, {
        warehouseId: warehouse.id,
        productId: item.productId,
        type: StockMovementType.SALE,
        quantity: item.quantity.neg(),
        reason: `Pedido #${orderId}`,
        orderId,
        createdById,
      });
    }
  }

  private async recalculate(tx: Prisma.TransactionClient, orderId: number) {
    const { _sum } = await tx.orderItem.aggregate({ where: { orderId }, _sum: { total: true } });
    return tx.order.update({ where: { id: orderId }, data: { total: _sum.total ?? 0 }, include: orderInclude });
  }

  private async openOrder(id: number, user: JwtPayload) {
    const order = await this.findOne(id, user);
    if (order.status !== OrderStatus.OPEN) {
      throw new ConflictException('Este pedido ja nao esta aberto');
    }
    return order;
  }
}

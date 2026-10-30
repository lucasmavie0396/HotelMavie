import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ChargeType,
  InvoiceType,
  OrderStatus,
  Outlet,
  PaymentMethod,
  PrepStation,
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
import { Ticket, TicketPdfService } from '../billing/ticket-pdf.service';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { tableLabel } from './tables';

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
  @IsInt()
  tableId?: number;

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
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsInt()
  paymentTypeId?: number;

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
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      product: { select: { category: { select: { prepStation: true, printerId: true } } } },
      voidedBy: { select: { name: true } },
    },
  },
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
    private readonly tickets: TicketPdfService,
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

  async open({ hotelId, tableId, ...data }: OpenOrderDto, user: JwtPayload) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    if (!tableId) {
      return this.prisma.order.create({ data: { ...data, hotelId: scoped, openedById: user.sub }, include: orderInclude });
    }
    return this.prisma.$transaction(async (tx) => {
      const [table] = await tx.$queryRaw<{ id: number; hotelId: number; outlet: Outlet; number: number; name: string | null; active: number | boolean }[]>`
        SELECT id, hotelId, outlet, number, name, active FROM dining_tables WHERE id = ${tableId} FOR UPDATE`;
      if (!table || table.hotelId !== scoped || !table.active) {
        throw new BadRequestException('Mesa invalida ou inativa');
      }
      if (table.outlet !== data.outlet) {
        throw new BadRequestException('Esta mesa pertence a outro ponto de venda');
      }
      const existing = await tx.order.findFirst({ where: { tableId, status: OrderStatus.OPEN }, include: orderInclude });
      if (existing) {
        return existing;
      }
      return tx.order.create({
        data: { ...data, tableId, tableLabel: tableLabel(table), hotelId: scoped, openedById: user.sub },
        include: orderInclude,
      });
    });
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
    const order = await this.openOrder(orderId, user);
    const item = order.items.find((line) => line.id === itemId);
    if (!item) {
      throw new NotFoundException('Linha nao encontrada');
    }
    if (item.sentAt) {
      throw new ConflictException('Esta linha ja foi enviada para preparacao: tem de ser anulada');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.orderItem.delete({ where: { id: itemId } });
      return this.recalculate(tx, orderId);
    });
  }

  async voidItem(orderId: number, itemId: number, reason: string, user: JwtPayload) {
    const order = await this.openOrder(orderId, user);
    if (user.role === UserRole.RECEPTION) {
      throw new ForbiddenException('So um gestor pode anular linhas enviadas para preparacao');
    }
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.orderItem.updateMany({
        where: { id: itemId, orderId: order.id, voidedAt: null },
        data: { voidedAt: new Date(), voidReason: reason, voidedById: user.sub },
      });
      if (!count) {
        throw new ConflictException('Esta linha nao existe ou ja foi anulada');
      }
      return this.recalculate(tx, orderId);
    });
  }

  async send(orderId: number, user: JwtPayload) {
    const order = await this.openOrder(orderId, user);
    const pending = order.items.filter((item) => !item.sentAt && !item.voidedAt);
    if (!pending.length) {
      throw new BadRequestException('Nao ha linhas novas para enviar');
    }
    const sentAt = new Date();
    await this.prisma.orderItem.updateMany({ where: { id: { in: pending.map((item) => item.id) } }, data: { sentAt } });
    const targets = new Map<string, { station: PrepStation; printerId: number | null }>();
    for (const item of pending) {
      const target = this.targetOf(order, item);
      if (target.station !== PrepStation.NONE || target.printerId) targets.set(`${target.station}:${target.printerId ?? ''}`, target);
    }
    return {
      sentAt,
      targets: [...targets.values()],
      stations: [...new Set([...targets.values()].map((target) => target.station))],
    };
  }

  async buildTicket(orderId: number, station: PrepStation, printerId: number | null | undefined, sentAt: string | undefined, user: JwtPayload) {
    const order = await this.findOne(orderId, user);
    const sent = order.items.filter((item) => {
      if (!item.sentAt) return false;
      const target = this.targetOf(order, item);
      return target.station === station && (printerId === undefined || target.printerId === printerId);
    });
    const batch = sentAt ? new Date(sentAt).getTime() : Math.max(0, ...sent.map((item) => item.sentAt!.getTime()));
    const items = sent.filter((item) => item.sentAt!.getTime() === batch);
    if (!items.length) {
      throw new NotFoundException('Nao ha linhas enviadas para este posto');
    }
    const ticket = new Ticket();
    ticket.text(station === PrepStation.BAR ? 'PEDIDO BAR' : station === PrepStation.KITCHEN ? 'PEDIDO COZINHA' : 'PEDIDO', { bold: true, size: 14, align: 'center' });
    ticket.text(`${order.tableLabel ?? `Pedido #${order.id}`}`, { bold: true, size: 14, align: 'center' });
    ticket.text(`${Ticket.when(new Date(batch))} · ${order.openedBy?.name ?? ''}`, { size: 8, align: 'center' });
    if (sent.some((item) => item.sentAt!.getTime() < batch)) ticket.text('(pedido adicional)', { size: 9, align: 'center', bold: true });
    ticket.rule();
    ticket.lines(items.map((item) => ({ quantity: item.quantity, description: item.description, notes: item.notes, struck: Boolean(item.voidedAt) })), false);
    ticket.rule();
    ticket.text(`${items.reduce((sum, item) => sum + Number(item.quantity), 0)} artigos`, { size: 8, align: 'right' });
    return { ticket, hotelId: order.hotelId, station, printerId: printerId ?? this.targetOf(order, items[0]).printerId };
  }

  async ticket(orderId: number, station: PrepStation, sentAt: string | undefined, user: JwtPayload) {
    return this.tickets.render((await this.buildTicket(orderId, station, undefined, sentAt, user)).ticket);
  }

  async buildVoidTicket(orderId: number, itemId: number, user: JwtPayload) {
    const order = await this.findOne(orderId, user);
    const item = order.items.find((line) => line.id === itemId && line.voidedAt);
    if (!item) {
      throw new NotFoundException('Linha anulada nao encontrada');
    }
    const target = this.targetOf(order, item);
    const ticket = new Ticket();
    ticket.text('*** ANULAR ***', { bold: true, size: 14, align: 'center' });
    ticket.text(target.station === PrepStation.BAR ? 'BAR' : 'COZINHA', { bold: true, align: 'center' });
    ticket.text(`${order.tableLabel ?? `Pedido #${order.id}`}`, { bold: true, size: 14, align: 'center' });
    ticket.text(Ticket.when(item.voidedAt!), { size: 8, align: 'center' });
    ticket.rule();
    ticket.lines([{ quantity: item.quantity, description: item.description }], false);
    ticket.text(`Motivo: ${item.voidReason ?? ''}`, { size: 10, bold: true });
    if (item.voidedBy) ticket.text(`Por: ${item.voidedBy.name}`, { size: 8 });
    return { ticket, hotelId: order.hotelId, station: target.station, printerId: target.printerId };
  }

  async voidTicket(orderId: number, itemId: number, user: JwtPayload) {
    return this.tickets.render((await this.buildVoidTicket(orderId, itemId, user)).ticket);
  }

  async buildPrebill(orderId: number, user: JwtPayload) {
    const order = await this.findOne(orderId, user);
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: order.hotelId } });
    const operator = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } });
    const items = order.items.filter((item) => !item.voidedAt);
    const ticket = new Ticket(hotel.currency).header(hotel);
    ticket.text('CONSULTA DE MESA', { bold: true, size: 12, align: 'center' });
    ticket.text(`${order.tableLabel ?? `Pedido #${order.id}`} · ${Ticket.when(new Date())}`, { size: 8, align: 'center' });
    if (order.reservation) ticket.text(`Lancado no quarto ${order.reservation.room.number}`, { size: 8, align: 'center' });
    ticket.rule();
    ticket.lines(items.map((item) => ({ quantity: item.quantity, description: item.description, unitPrice: item.unitPrice, total: item.total })));
    ticket.rule();
    ticket.cols(`${items.reduce((sum, item) => sum + Number(item.quantity), 0)} artigos`, '', { size: 8 });
    ticket.cols('TOTAL (IVA incluido)', ticket.money(order.total), { bold: true, size: 13 });
    ticket.space();
    ticket.text('Este documento nao serve de fatura. Peca a fatura no pagamento.', { size: 7, align: 'center' });
    ticket.footer(hotel, operator?.name);
    return { ticket, hotelId: order.hotelId };
  }

  async prebill(orderId: number, user: JwtPayload) {
    return this.tickets.render((await this.buildPrebill(orderId, user)).ticket);
  }

  private targetOf(order: { outlet: Outlet }, item: { product: { category: { prepStation: PrepStation; printerId: number | null } | null } }) {
    return {
      station: item.product.category?.prepStation ?? (order.outlet === Outlet.BAR ? PrepStation.BAR : PrepStation.KITCHEN),
      printerId: item.product.category?.printerId ?? null,
    };
  }

  async cancel(orderId: number, user: JwtPayload) {
    const order = await this.openOrder(orderId, user);
    if (order.items.some((item) => !item.voidedAt) && user.role === UserRole.RECEPTION) {
      throw new ForbiddenException('So um gestor pode anular pedidos com produtos');
    }
    await this.prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED, closedAt: new Date() } });
    return this.findOne(orderId, user);
  }

  async close(orderId: number, dto: CloseOrderDto, user: JwtPayload) {
    const order = await this.openOrder(orderId, user);
    const items = order.items.filter((item) => !item.voidedAt);
    if (!items.length) {
      throw new BadRequestException('O pedido nao tem produtos');
    }
    const chargeType = order.outlet === Outlet.BAR ? ChargeType.BAR : ChargeType.RESTAURANT;
    const label = order.outlet === Outlet.BAR ? 'Bar' : 'Restaurante';
    if (dto.mode === 'PAY') {
      await this.invoices.ensureSeries(order.hotelId, InvoiceType.INVOICE_RECEIPT);
    }

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
      for (const item of items) {
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
            productCode: `P${item.productId}`,
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
              paymentTypeId: payment.paymentTypeId,
              cashSessionId: payment.cashSessionId,
              reference: payment.reference,
              createdById: user.sub,
            },
            user,
          );
          await tx.payment.update({ where: { id: created.id }, data: { orderId } });
        }
      }

      await tx.orderItem.updateMany({ where: { orderId, sentAt: null, voidedAt: null }, data: { sentAt: new Date() } });
      await this.deductStock(tx, order.hotelId, order.id, items, user.sub);
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
    const products = await tx.product.findMany({
      where: { id: { in: items.map((item) => item.productId) } },
      select: { id: true, name: true, trackStock: true, recipeItems: { select: { ingredientId: true, quantity: true } } },
    });
    const consumption = new Map<number, { quantity: Prisma.Decimal; reasons: Set<string> }>();
    const consume = (productId: number, quantity: Prisma.Decimal, reason: string) => {
      const current = consumption.get(productId) ?? { quantity: new Prisma.Decimal(0), reasons: new Set<string>() };
      current.quantity = current.quantity.add(quantity);
      current.reasons.add(reason);
      consumption.set(productId, current);
    };
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) continue;
      if (product.recipeItems.length) {
        for (const line of product.recipeItems) {
          consume(line.ingredientId, line.quantity.mul(item.quantity), product.name);
        }
      } else if (product.trackStock) {
        consume(product.id, item.quantity, product.name);
      }
    }
    if (!consumption.size) {
      return;
    }
    const warehouse = await this.stock.defaultWarehouse(tx, hotelId);
    for (const [productId, { quantity, reasons }] of consumption) {
      await this.stock.move(tx, {
        warehouseId: warehouse.id,
        productId,
        type: StockMovementType.SALE,
        quantity: quantity.neg(),
        reason: `Pedido #${orderId} (${[...reasons].join(', ')})`.slice(0, 200),
        orderId,
        createdById,
      });
    }
  }

  private async recalculate(tx: Prisma.TransactionClient, orderId: number) {
    const { _sum } = await tx.orderItem.aggregate({ where: { orderId, voidedAt: null }, _sum: { total: true } });
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

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { PaperWidth, Prisma, PurchaseStatus, StockMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { Ticket } from '../billing/ticket-pdf.service';
import { parseDate } from '../common/dates';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney, toMoney } from '../common/money';
import { MailService } from '../mail/mail.service';
import { purchaseOrderEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { Report } from '../reports/report-model';
import { ReportRenderService } from '../reports/report-render.service';
import { StockService } from '../stock/stock.service';

export class SupplierDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  taxId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateSupplierDto extends PartialType(SupplierDto) {}

export class PurchaseItemDto {
  @IsInt()
  productId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost: number;
}

export class PurchaseDto {
  @IsInt()
  supplierId: number;

  @IsInt()
  warehouseId: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  supplierRef?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];
}

export class ReceiveItemDto {
  @IsInt()
  itemId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  lot?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  expiryDate?: string;
}

export class ReceiveDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items?: ReceiveItemDto[];
}

export class SuggestionQueryDto extends HotelQueryDto {
  @Type(() => Number)
  @IsInt()
  warehouseId: number;
}

export class PurchaseQueryDto extends HotelQueryDto {
  @IsOptional()
  @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  supplierId?: number;
}

const purchaseInclude = {
  supplier: { select: { id: true, name: true, email: true } },
  warehouse: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, unit: true, trackExpiry: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.PurchaseInclude;

export function purchaseNumber(purchase: { id: number; orderedAt: Date }) {
  return `ENC ${purchase.orderedAt.getUTCFullYear()}/${purchase.id}`;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly render: ReportRenderService,
    private readonly mail: MailService,
  ) {}

  suppliers(query: HotelQueryDto, user: JwtPayload) {
    return this.prisma.supplier.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId) },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  createSupplier({ hotelId, ...data }: SupplierDto, user: JwtPayload) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    return this.prisma.supplier.create({ data: { ...data, hotelId: scoped } });
  }

  async updateSupplier(id: number, { hotelId: _ignored, ...data }: UpdateSupplierDto, user: JwtPayload) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier || !canAccessHotel(user, supplier.hotelId)) {
      throw new NotFoundException('Fornecedor nao encontrado');
    }
    return this.prisma.supplier.update({ where: { id }, data });
  }

  findAll(query: PurchaseQueryDto, user: JwtPayload) {
    return this.prisma.purchase.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId), status: query.status, supplierId: query.supplierId },
      include: purchaseInclude,
      orderBy: { orderedAt: 'desc' },
      take: 300,
    });
  }

  async findOne(id: number, user: JwtPayload) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id }, include: purchaseInclude });
    if (!purchase || !canAccessHotel(user, purchase.hotelId)) {
      throw new NotFoundException('Compra nao encontrada');
    }
    return purchase;
  }

  async create(dto: PurchaseDto, user: JwtPayload) {
    const hotelId = await this.validate(dto, user);
    return this.prisma.purchase.create({
      data: {
        hotelId,
        supplierId: dto.supplierId,
        warehouseId: dto.warehouseId,
        supplierRef: dto.supplierRef,
        notes: dto.notes,
        createdById: user.sub,
        ...this.itemsData(dto.items),
      },
      include: purchaseInclude,
    });
  }

  async update(id: number, dto: PurchaseDto, user: JwtPayload) {
    const purchase = await this.findOne(id, user);
    if (purchase.status !== PurchaseStatus.DRAFT) {
      throw new ConflictException('So e possivel alterar compras em rascunho');
    }
    await this.validate(dto, user);
    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      const { items, total } = this.itemsData(dto.items);
      return tx.purchase.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          supplierRef: dto.supplierRef,
          notes: dto.notes,
          total,
          items,
        },
        include: purchaseInclude,
      });
    });
  }

  async receive(id: number, dto: ReceiveDto, user: JwtPayload) {
    await this.findOne(id, user);
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: PurchaseStatus; warehouseId: number; supplierRef: string | null }[]>`
        SELECT status, warehouseId, supplierRef FROM purchases WHERE id = ${id} FOR UPDATE`;
      if (locked.status !== PurchaseStatus.DRAFT && locked.status !== PurchaseStatus.PARTIAL) {
        throw new ConflictException('Esta compra ja foi recebida ou cancelada');
      }
      const lines = await tx.$queryRaw<{ id: number; productId: number; quantity: Prisma.Decimal; receivedQuantity: Prisma.Decimal; unitCost: Prisma.Decimal }[]>`
        SELECT id, productId, quantity, receivedQuantity, unitCost FROM purchase_items WHERE purchaseId = ${id} ORDER BY id FOR UPDATE`;
      const requested = new Map((dto.items ?? []).map((item) => [item.itemId, item]));
      if ([...requested.keys()].some((itemId) => !lines.some((line) => line.id === itemId))) {
        throw new BadRequestException('Linha de compra invalida');
      }
      const receipts = lines
        .map((line) => {
          const remaining = new Prisma.Decimal(line.quantity).sub(line.receivedQuantity);
          const request = requested.get(line.id);
          const quantity = dto.items ? new Prisma.Decimal(request?.quantity ?? 0) : remaining;
          if (quantity.greaterThan(remaining)) {
            throw new BadRequestException(`So faltam receber ${remaining.toString()} da linha ${line.id}`);
          }
          return { line, quantity, remaining, request };
        })
        .filter((receipt) => receipt.quantity.greaterThan(0));
      if (!receipts.length) {
        throw new BadRequestException('Indica as quantidades recebidas');
      }
      const productIds = [...new Set(receipts.map(({ line }) => line.productId))];
      await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`;
      const complete = lines.every((line) => {
        const receipt = receipts.find((r) => r.line.id === line.id);
        return new Prisma.Decimal(line.quantity).sub(line.receivedQuantity).sub(receipt?.quantity ?? 0).isZero();
      });
      const reference = locked.supplierRef ? `Compra ${locked.supplierRef}` : `Compra #${id}`;
      for (const { line, quantity, request } of receipts) {
        const unitCost = new Prisma.Decimal(line.unitCost);
        const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId }, include: { stockLevels: true } });
        const onHand = product.stockLevels.reduce((total, level) => total.add(Prisma.Decimal.max(level.quantity, 0)), new Prisma.Decimal(0));
        const newQuantity = onHand.add(quantity);
        const averageCost = newQuantity.isZero() ? unitCost : onHand.mul(product.cost).add(quantity.mul(unitCost)).div(newQuantity).toDecimalPlaces(4);
        await tx.product.update({ where: { id: product.id }, data: { cost: averageCost } });
        await tx.purchaseItem.update({ where: { id: line.id }, data: { receivedQuantity: { increment: quantity } } });
        await this.stock.move(tx, {
          warehouseId: locked.warehouseId,
          productId: line.productId,
          type: StockMovementType.PURCHASE,
          quantity,
          unitCost,
          reason: complete && locked.status === PurchaseStatus.DRAFT ? reference : `${reference} (parcial)`,
          purchaseId: id,
          createdById: user.sub,
          lot: { code: request?.lot ?? null, expiryDate: request?.expiryDate ? parseDate(request.expiryDate) : null },
        });
      }
      await tx.purchase.update({
        where: { id },
        data: complete ? { status: PurchaseStatus.RECEIVED, receivedAt: new Date() } : { status: PurchaseStatus.PARTIAL },
      });
      return tx.purchase.findUniqueOrThrow({ where: { id }, include: purchaseInclude });
    });
  }

  async close(id: number, user: JwtPayload) {
    await this.findOne(id, user);
    const { count } = await this.prisma.purchase.updateMany({
      where: { id, status: PurchaseStatus.PARTIAL },
      data: { status: PurchaseStatus.RECEIVED, receivedAt: new Date() },
    });
    if (!count) {
      throw new ConflictException('So e possivel concluir compras recebidas em parte');
    }
    return this.findOne(id, user);
  }

  async pdf(id: number, paper: PaperWidth, user: JwtPayload) {
    const purchase = await this.findOne(id, user);
    const [hotel, operator, supplier] = await Promise.all([
      this.prisma.hotel.findUniqueOrThrow({ where: { id: purchase.hotelId } }),
      this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } }),
      this.prisma.supplier.findUniqueOrThrow({ where: { id: purchase.supplier.id } }),
    ]);
    const money = (value: Prisma.Decimal.Value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: hotel.currency }).format(Number(value.toString()));
    const qty = (value: Prisma.Decimal.Value) => Number(value.toString()).toLocaleString('pt-PT', { maximumFractionDigits: 3 });
    const partial = purchase.items.some((item) => item.receivedQuantity.greaterThan(0));
    const report: Report = {
      key: 'purchase-order',
      title: `Nota de encomenda ${purchaseNumber(purchase)}`,
      period: `${supplier.name} · ${Ticket.day(purchase.orderedAt)}`,
      generatedAt: Ticket.when(new Date()),
      generatedBy: operator?.name ?? '-',
      hotel,
      sections: [
        {
          title: 'Fornecedor',
          kpis: [
            { label: 'Fornecedor', value: supplier.name },
            { label: 'NIF', value: supplier.taxId ?? '-' },
            { label: 'Entregar em', value: purchase.warehouse.name },
            { label: 'Data', value: Ticket.day(purchase.orderedAt) },
          ],
        },
        {
          title: 'Artigos',
          table: {
            columns: [
              { label: 'Produto', weight: 2.6 },
              { label: 'Unid.', weight: 0.6 },
              { label: 'Quantidade', align: 'right', weight: 1 },
              ...(partial ? [{ label: 'Recebido', align: 'right' as const, weight: 1 }] : []),
              { label: 'Preco unit.', align: 'right', weight: 1 },
              { label: 'Total', align: 'right', weight: 1 },
            ],
            rows: purchase.items.map((item) => [
              item.product.name,
              item.product.unit,
              qty(item.quantity),
              ...(partial ? [qty(item.receivedQuantity)] : []),
              money(item.unitCost),
              money(item.total),
            ]),
            totals: ['Total', '', '', ...(partial ? [''] : []), '', money(purchase.total)],
          },
          note: [purchase.supplierRef ? `Referencia: ${purchase.supplierRef}` : null, purchase.notes].filter(Boolean).join(' · ') || undefined,
        },
      ],
    };
    return { buffer: await this.render.pdf(report, paper), name: `encomenda-${purchase.id}` };
  }

  async send(id: number, user: JwtPayload) {
    const purchase = await this.findOne(id, user);
    if (purchase.status !== PurchaseStatus.DRAFT && purchase.status !== PurchaseStatus.PARTIAL) {
      throw new ConflictException('So e possivel enviar encomendas por receber');
    }
    const [hotel, supplier] = await Promise.all([
      this.prisma.hotel.findUniqueOrThrow({ where: { id: purchase.hotelId } }),
      this.prisma.supplier.findUniqueOrThrow({ where: { id: purchase.supplier.id } }),
    ]);
    if (!supplier.email) {
      throw new BadRequestException('O fornecedor nao tem email');
    }
    const { buffer, name } = await this.pdf(id, PaperWidth.A4, user);
    const email = purchaseOrderEmail(hotel, { number: purchaseNumber(purchase), supplierName: supplier.name, total: purchase.total });
    const log = await this.mail.send({
      hotelId: hotel.id,
      kind: 'PURCHASE_ORDER',
      to: supplier.email,
      replyTo: hotel.email,
      subject: email.subject,
      html: email.html,
      relatedId: purchase.id,
      attachments: [{ filename: `${name}.pdf`, content: buffer, contentType: 'application/pdf' }],
    });
    if (log.status !== 'FAILED') {
      await this.prisma.purchase.update({ where: { id }, data: { sentAt: new Date() } });
    }
    return { status: log.status, to: supplier.email, error: log.error };
  }

  async suggestions(query: SuggestionQueryDto, user: JwtPayload) {
    const warehouse = await this.stock.findWarehouse(query.warehouseId, user);
    const products = await this.prisma.product.findMany({
      where: { hotelId: warehouse.hotelId, trackStock: true, active: true, minStock: { gt: 0 } },
      include: {
        stockLevels: { where: { warehouseId: warehouse.id } },
        purchaseItems: {
          where: { purchase: { status: { not: PurchaseStatus.CANCELLED } } },
          include: { purchase: { select: { status: true, warehouseId: true, orderedAt: true, supplier: { select: { id: true, name: true, active: true } } } } },
          orderBy: { purchase: { orderedAt: 'desc' } },
          take: 20,
        },
      },
      orderBy: { name: 'asc' },
    });
    return products
      .map((product) => {
        const quantity = product.stockLevels[0]?.quantity ?? new Prisma.Decimal(0);
        const pending = product.purchaseItems
          .filter((item) => item.purchase.warehouseId === warehouse.id && (item.purchase.status === PurchaseStatus.DRAFT || item.purchase.status === PurchaseStatus.PARTIAL))
          .reduce((sum, item) => sum.add(item.quantity.sub(item.receivedQuantity)), new Prisma.Decimal(0));
        const last = product.purchaseItems.find((item) => item.purchase.supplier.active);
        const target = product.minStock.mul(2);
        const suggested = Prisma.Decimal.max(target.sub(quantity).sub(pending), 0).toDecimalPlaces(3, Prisma.Decimal.ROUND_UP);
        return {
          productId: product.id,
          name: product.name,
          unit: product.unit,
          quantity,
          minStock: product.minStock,
          pending,
          suggested,
          unitCost: last?.unitCost ?? product.cost,
          supplier: last ? { id: last.purchase.supplier.id, name: last.purchase.supplier.name } : null,
        };
      })
      .filter((row) => row.quantity.lessThan(row.minStock) && row.suggested.greaterThan(0));
  }

  async cancel(id: number, user: JwtPayload) {
    await this.findOne(id, user);
    const { count } = await this.prisma.purchase.updateMany({
      where: { id, status: PurchaseStatus.DRAFT },
      data: { status: PurchaseStatus.CANCELLED },
    });
    if (!count) {
      throw new ConflictException('So e possivel cancelar compras em rascunho');
    }
    return this.findOne(id, user);
  }

  private itemsData(items: PurchaseItemDto[]) {
    const lines = items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      total: toMoney(new Prisma.Decimal(item.quantity).mul(item.unitCost)),
    }));
    return { items: { createMany: { data: lines } }, total: sumMoney(lines.map((line) => line.total)) };
  }

  private async validate(dto: PurchaseDto, user: JwtPayload) {
    const [supplier, warehouse, products] = await Promise.all([
      this.prisma.supplier.findUnique({ where: { id: dto.supplierId } }),
      this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } }),
      this.prisma.product.findMany({ where: { id: { in: dto.items.map((item) => item.productId) } } }),
    ]);
    if (!supplier || !canAccessHotel(user, supplier.hotelId)) {
      throw new NotFoundException('Fornecedor nao encontrado');
    }
    if (!warehouse || warehouse.hotelId !== supplier.hotelId) {
      throw new BadRequestException('Armazem invalido para este hotel');
    }
    const valid = new Set(products.filter((p) => p.hotelId === supplier.hotelId && p.trackStock).map((p) => p.id));
    const invalid = dto.items.filter((item) => !valid.has(item.productId));
    if (invalid.length) {
      throw new BadRequestException('Todos os produtos tem de pertencer ao hotel e controlar stock');
    }
    return supplier.hotelId;
  }
}

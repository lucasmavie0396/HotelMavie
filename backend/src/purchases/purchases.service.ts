import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { Prisma, PurchaseStatus, StockMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
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
  supplier: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, unit: true } } } },
} satisfies Prisma.PurchaseInclude;

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
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

  async receive(id: number, user: JwtPayload) {
    await this.findOne(id, user);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.purchase.updateMany({
        where: { id, status: PurchaseStatus.DRAFT },
        data: { status: PurchaseStatus.RECEIVED, receivedAt: new Date() },
      });
      if (!count) {
        throw new ConflictException('Esta compra ja foi recebida ou cancelada');
      }
      const items = await tx.$queryRaw<{ productId: number }[]>`SELECT productId FROM purchase_items WHERE purchaseId = ${id}`;
      const productIds = [...new Set(items.map((item) => item.productId))];
      await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`;
      const purchase = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: true } });
      for (const item of purchase.items) {
        const product = await tx.product.findUniqueOrThrow({
          where: { id: item.productId },
          include: { stockLevels: true },
        });
        const onHand = product.stockLevels.reduce((total, level) => total.add(Prisma.Decimal.max(level.quantity, 0)), new Prisma.Decimal(0));
        const newQuantity = onHand.add(item.quantity);
        const averageCost = newQuantity.isZero()
          ? item.unitCost
          : onHand.mul(product.cost).add(item.quantity.mul(item.unitCost)).div(newQuantity).toDecimalPlaces(4);
        await tx.product.update({ where: { id: product.id }, data: { cost: averageCost } });
        await this.stock.move(tx, {
          warehouseId: purchase.warehouseId,
          productId: item.productId,
          type: StockMovementType.PURCHASE,
          quantity: item.quantity,
          unitCost: item.unitCost,
          reason: purchase.supplierRef ? `Compra ${purchase.supplierRef}` : `Compra #${purchase.id}`,
          purchaseId: purchase.id,
          createdById: user.sub,
        });
      }
      return tx.purchase.findUniqueOrThrow({ where: { id }, include: purchaseInclude });
    });
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

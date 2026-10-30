import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';

export class CreateWarehouseDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class AdjustStockDto {
  @IsInt()
  productId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  countedQuantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class WasteDto {
  @IsInt()
  productId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsString()
  @MaxLength(200)
  reason: string;
}

export class TransferDto {
  @IsInt()
  productId: number;

  @IsInt()
  toWarehouseId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;
}

export class MovementQueryDto extends HotelQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  warehouseId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;

  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;
}

export class LotQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;
}

export interface MoveInput {
  warehouseId: number;
  productId: number;
  type: StockMovementType;
  quantity: Prisma.Decimal.Value;
  unitCost?: Prisma.Decimal.Value;
  reason?: string;
  orderId?: number;
  purchaseId?: number;
  documentId?: number;
  createdById?: number;
  lot?: { code?: string | null; expiryDate?: Date | null };
  lots?: LotPart[];
}

export interface LotPart {
  code: string | null;
  expiryDate: Date | null;
  quantity: Prisma.Decimal;
}

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  warehouses(query: HotelQueryDto, user: JwtPayload) {
    return this.prisma.warehouse.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId), active: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  createWarehouse({ hotelId, ...data }: CreateWarehouseDto, user: JwtPayload) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.warehouse.count({ where: { hotelId: scoped } });
      const isDefault = data.isDefault || count === 0;
      if (isDefault) {
        await tx.warehouse.updateMany({ where: { hotelId: scoped }, data: { isDefault: false } });
      }
      return tx.warehouse.create({ data: { ...data, hotelId: scoped, isDefault } });
    });
  }

  async levels(warehouseId: number, user: JwtPayload) {
    const warehouse = await this.findWarehouse(warehouseId, user);
    const products = await this.prisma.product.findMany({
      where: { hotelId: warehouse.hotelId, trackStock: true, active: true },
      include: { stockLevels: { where: { warehouseId } }, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return products.map(({ stockLevels, ...product }) => {
      const quantity = stockLevels[0]?.quantity ?? new Prisma.Decimal(0);
      return { ...product, quantity, belowMinimum: quantity.lessThan(product.minStock) };
    });
  }

  movements(query: MovementQueryDto, user: JwtPayload) {
    return this.prisma.stockMovement.findMany({
      where: {
        warehouse: { hotelId: resolveHotelScope(user, query.hotelId) },
        warehouseId: query.warehouseId,
        productId: query.productId,
        type: query.type,
      },
      include: {
        product: { select: { name: true, unit: true } },
        warehouse: { select: { name: true } },
        createdBy: { select: { name: true } },
        document: { select: { id: true, type: true, year: true, number: true } },
        purchase: { select: { id: true, supplierRef: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 300,
    });
  }

  async adjust(warehouseId: number, dto: AdjustStockDto, user: JwtPayload) {
    await this.findWarehouse(warehouseId, user);
    return this.prisma.$transaction(async (tx) => {
      const current = await this.currentQuantity(tx, warehouseId, dto.productId);
      const difference = new Prisma.Decimal(dto.countedQuantity).sub(current);
      if (difference.isZero()) {
        return null;
      }
      return this.move(tx, {
        warehouseId,
        productId: dto.productId,
        type: StockMovementType.ADJUSTMENT,
        quantity: difference,
        reason: dto.reason ?? 'Contagem de inventario',
        createdById: user.sub,
      });
    });
  }

  async waste(warehouseId: number, dto: WasteDto, user: JwtPayload) {
    await this.findWarehouse(warehouseId, user);
    return this.prisma.$transaction((tx) =>
      this.move(tx, {
        warehouseId,
        productId: dto.productId,
        type: StockMovementType.WASTE,
        quantity: new Prisma.Decimal(dto.quantity).neg(),
        reason: dto.reason,
        createdById: user.sub,
      }),
    );
  }

  async transfer(warehouseId: number, dto: TransferDto, user: JwtPayload) {
    const from = await this.findWarehouse(warehouseId, user);
    const to = await this.findWarehouse(dto.toWarehouseId, user);
    if (from.id === to.id || from.hotelId !== to.hotelId) {
      throw new BadRequestException('Escolhe outro armazem do mesmo hotel');
    }
    return this.prisma.$transaction(async (tx) => {
      const available = await this.currentQuantity(tx, from.id, dto.productId);
      if (available.lessThan(dto.quantity)) {
        throw new ConflictException(`So ha ${available.toString()} em stock em ${from.name}`);
      }
      const reason = `${from.name} -> ${to.name}`;
      await this.move(tx, {
        warehouseId: from.id,
        productId: dto.productId,
        type: StockMovementType.TRANSFER_OUT,
        quantity: new Prisma.Decimal(dto.quantity).neg(),
        reason,
        createdById: user.sub,
      });
      return this.move(tx, {
        warehouseId: to.id,
        productId: dto.productId,
        type: StockMovementType.TRANSFER_IN,
        quantity: dto.quantity,
        reason,
        createdById: user.sub,
      });
    });
  }

  async move(tx: Prisma.TransactionClient, input: MoveInput) {
    const [product, warehouse] = await Promise.all([
      tx.product.findUnique({ where: { id: input.productId } }),
      tx.warehouse.findUniqueOrThrow({ where: { id: input.warehouseId } }),
    ]);
    if (!product || product.hotelId !== warehouse.hotelId) {
      throw new NotFoundException('Produto nao encontrado neste hotel');
    }
    if (!product.trackStock) {
      throw new BadRequestException(`O produto ${product.name} nao controla stock`);
    }
    const quantity = new Prisma.Decimal(input.quantity);
    const level = await tx.stockLevel.upsert({
      where: { warehouseId_productId: { warehouseId: input.warehouseId, productId: input.productId } },
      update: { quantity: { increment: quantity } },
      create: { warehouseId: input.warehouseId, productId: input.productId, quantity },
    });
    let lots: LotPart[] = [];
    if (product.trackExpiry && quantity.greaterThan(0)) {
      await this.addLots(tx, input.warehouseId, input.productId, quantity, input.lots ?? [{ code: input.lot?.code ?? null, expiryDate: input.lot?.expiryDate ?? null, quantity }]);
    } else if (product.trackExpiry && quantity.isNegative()) {
      lots = await this.consumeLots(tx, input.warehouseId, input.productId, quantity.neg());
    }
    const movement = await tx.stockMovement.create({
      data: {
        warehouseId: input.warehouseId,
        productId: input.productId,
        type: input.type,
        quantity,
        unitCost: input.unitCost ?? product.cost,
        balance: level.quantity,
        reason: input.reason,
        orderId: input.orderId,
        purchaseId: input.purchaseId,
        documentId: input.documentId,
        createdById: input.createdById,
      },
    });
    return Object.assign(movement, { lots });
  }

  lots(warehouseId: number, productId: number | undefined, user: JwtPayload) {
    return this.findWarehouse(warehouseId, user).then(() =>
      this.prisma.stockLot.findMany({
        where: { warehouseId, productId, quantity: { gt: 0 } },
        include: { product: { select: { id: true, name: true, unit: true } } },
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      }),
    );
  }

  private async addLots(tx: Prisma.TransactionClient, warehouseId: number, productId: number, total: Prisma.Decimal, parts: LotPart[]) {
    const covered = parts.reduce((sum, part) => sum.add(part.quantity), new Prisma.Decimal(0));
    const all = covered.lessThan(total) ? [...parts, { code: null, expiryDate: null, quantity: total.sub(covered) }] : parts;
    for (const part of all) {
      if (!part.quantity.greaterThan(0)) continue;
      const code = part.code?.trim() || null;
      const same = await tx.stockLot.findFirst({ where: { warehouseId, productId, code, expiryDate: part.expiryDate } });
      if (same) {
        await tx.stockLot.update({ where: { id: same.id }, data: { quantity: { increment: part.quantity } } });
      } else {
        await tx.stockLot.create({ data: { warehouseId, productId, code, expiryDate: part.expiryDate, quantity: part.quantity } });
      }
    }
  }

  private async consumeLots(tx: Prisma.TransactionClient, warehouseId: number, productId: number, quantity: Prisma.Decimal) {
    const lots = await tx.$queryRaw<{ id: number; code: string | null; expiryDate: Date | null; quantity: Prisma.Decimal }[]>`
      SELECT id, code, expiryDate, quantity FROM stock_lots
      WHERE warehouseId = ${warehouseId} AND productId = ${productId} AND quantity > 0
      ORDER BY expiryDate IS NULL, expiryDate, id FOR UPDATE`;
    const used: LotPart[] = [];
    let missing = quantity;
    for (const lot of lots) {
      if (!missing.greaterThan(0)) break;
      const take = Prisma.Decimal.min(new Prisma.Decimal(lot.quantity), missing);
      await tx.stockLot.update({ where: { id: lot.id }, data: { quantity: { decrement: take } } });
      used.push({ code: lot.code, expiryDate: lot.expiryDate, quantity: take });
      missing = missing.sub(take);
    }
    return used;
  }

  async defaultWarehouse(tx: Prisma.TransactionClient, hotelId: number) {
    const warehouse = await tx.warehouse.findFirst({ where: { hotelId, isDefault: true, active: true } });
    if (!warehouse) {
      throw new ConflictException('Define um armazem principal antes de vender produtos com controlo de stock');
    }
    return warehouse;
  }

  private async currentQuantity(tx: Prisma.TransactionClient, warehouseId: number, productId: number) {
    const level = await tx.stockLevel.findUnique({ where: { warehouseId_productId: { warehouseId, productId } } });
    return level?.quantity ?? new Prisma.Decimal(0);
  }

  async findWarehouse(id: number, user: JwtPayload) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse || !canAccessHotel(user, warehouse.hotelId)) {
      throw new NotFoundException('Armazem nao encontrado');
    }
    return warehouse;
  }
}

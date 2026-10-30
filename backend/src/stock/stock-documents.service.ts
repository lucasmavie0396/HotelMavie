import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockDocumentStatus, StockDocumentType, StockMovementType, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';

export class StockDocumentItemDto {
  @IsInt()
  productId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity: number;
}

export class StockDocumentDto {
  @IsEnum(StockDocumentType)
  type: StockDocumentType;

  @IsInt()
  warehouseId: number;

  @IsOptional()
  @IsInt()
  toWarehouseId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => StockDocumentItemDto)
  items: StockDocumentItemDto[];
}

export class StockDocumentQueryDto extends HotelQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  warehouseId?: number;

  @IsOptional()
  @IsEnum(StockDocumentType)
  type?: StockDocumentType;

  @IsOptional()
  @IsEnum(StockDocumentStatus)
  status?: StockDocumentStatus;
}

const documentInclude = {
  warehouse: { select: { id: true, name: true } },
  toWarehouse: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  items: { include: { product: { select: { id: true, name: true, unit: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.StockDocumentInclude;

const LABELS: Record<StockDocumentType, string> = {
  INVENTORY: 'Inventario',
  WASTE: 'Quebra',
  TRANSFER: 'Transferencia',
};

@Injectable()
export class StockDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  findAll(query: StockDocumentQueryDto, user: JwtPayload) {
    return this.prisma.stockDocument.findMany({
      where: {
        hotelId: resolveHotelScope(user, query.hotelId),
        type: query.type,
        status: query.status,
        ...(query.warehouseId ? { OR: [{ warehouseId: query.warehouseId }, { toWarehouseId: query.warehouseId }] } : {}),
      },
      include: documentInclude,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async findOne(id: number, user: JwtPayload) {
    const document = await this.prisma.stockDocument.findUnique({ where: { id }, include: documentInclude });
    if (!document || !canAccessHotel(user, document.hotelId)) {
      throw new NotFoundException('Documento nao encontrado');
    }
    return document;
  }

  async create(dto: StockDocumentDto, user: JwtPayload) {
    const hotelId = await this.validate(dto, user);
    return this.prisma.stockDocument.create({
      data: {
        hotelId,
        type: dto.type,
        warehouseId: dto.warehouseId,
        toWarehouseId: dto.type === StockDocumentType.TRANSFER ? dto.toWarehouseId : null,
        reason: dto.reason,
        createdById: user.sub,
        items: { createMany: { data: dto.items.map(({ productId, quantity }) => ({ productId, quantity })) } },
      },
      include: documentInclude,
    });
  }

  async update(id: number, dto: StockDocumentDto, user: JwtPayload) {
    const document = await this.findOne(id, user);
    this.allow(document.type, user);
    if (document.status !== StockDocumentStatus.DRAFT) {
      throw new ConflictException('So e possivel alterar documentos em rascunho');
    }
    if (dto.type !== document.type) {
      throw new BadRequestException('Nao e possivel mudar o tipo do documento');
    }
    await this.validate(dto, user);
    return this.prisma.$transaction(async (tx) => {
      await tx.stockDocumentItem.deleteMany({ where: { documentId: id } });
      return tx.stockDocument.update({
        where: { id },
        data: {
          warehouseId: dto.warehouseId,
          toWarehouseId: dto.type === StockDocumentType.TRANSFER ? dto.toWarehouseId : null,
          reason: dto.reason ?? null,
          items: { createMany: { data: dto.items.map(({ productId, quantity }) => ({ productId, quantity })) } },
        },
        include: documentInclude,
      });
    });
  }

  async post(id: number, user: JwtPayload) {
    const document = await this.findOne(id, user);
    this.allow(document.type, user);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.stockDocument.updateMany({
        where: { id, status: StockDocumentStatus.DRAFT },
        data: { status: StockDocumentStatus.POSTED, postedAt: new Date() },
      });
      if (!count) {
        throw new ConflictException('Este documento ja foi lancado ou cancelado');
      }
      const items = await tx.stockDocumentItem.findMany({ where: { documentId: id }, orderBy: { id: 'asc' } });
      const productIds = [...new Set(items.map((item) => item.productId))];
      await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`;
      const levels = await tx.$queryRaw<{ productId: number; quantity: Prisma.Decimal }[]>`
        SELECT productId, quantity FROM stock_levels
        WHERE warehouseId = ${document.warehouseId} AND productId IN (${Prisma.join(productIds)}) FOR UPDATE`;
      const onHand = new Map(levels.map((level) => [level.productId, new Prisma.Decimal(level.quantity)]));
      const names = new Map(document.items.map((item) => [item.productId, item.product.name]));
      const number = `#${document.id}`;
      for (const item of items) {
        const current = onHand.get(item.productId) ?? new Prisma.Decimal(0);
        const move = { productId: item.productId, createdById: user.sub, documentId: id };
        if (document.type === StockDocumentType.INVENTORY) {
          await tx.stockDocumentItem.update({ where: { id: item.id }, data: { previousQuantity: current } });
          const difference = item.quantity.sub(current);
          if (difference.isZero()) continue;
          await this.stock.move(tx, {
            ...move,
            warehouseId: document.warehouseId,
            type: StockMovementType.ADJUSTMENT,
            quantity: difference,
            reason: [`Inventario ${number}`, document.reason].filter(Boolean).join(': '),
          });
        } else if (document.type === StockDocumentType.WASTE) {
          await this.stock.move(tx, {
            ...move,
            warehouseId: document.warehouseId,
            type: StockMovementType.WASTE,
            quantity: item.quantity.neg(),
            reason: [`Quebra ${number}`, document.reason].filter(Boolean).join(': '),
          });
        } else {
          if (current.lessThan(item.quantity)) {
            throw new ConflictException(`So ha ${current.toString()} de ${names.get(item.productId)} em ${document.warehouse.name}`);
          }
          const reason = `${document.warehouse.name} -> ${document.toWarehouse?.name} (${number})`;
          await this.stock.move(tx, { ...move, warehouseId: document.warehouseId, type: StockMovementType.TRANSFER_OUT, quantity: item.quantity.neg(), reason });
          await this.stock.move(tx, { ...move, warehouseId: document.toWarehouseId!, type: StockMovementType.TRANSFER_IN, quantity: item.quantity, reason });
        }
      }
      return tx.stockDocument.findUniqueOrThrow({ where: { id }, include: documentInclude });
    });
  }

  async cancel(id: number, user: JwtPayload) {
    const document = await this.findOne(id, user);
    this.allow(document.type, user);
    const { count } = await this.prisma.stockDocument.updateMany({
      where: { id, status: StockDocumentStatus.DRAFT },
      data: { status: StockDocumentStatus.CANCELLED },
    });
    if (!count) {
      throw new ConflictException('So e possivel cancelar documentos em rascunho');
    }
    return this.findOne(id, user);
  }

  private allow(type: StockDocumentType, user: JwtPayload) {
    if (type !== StockDocumentType.WASTE && user.role === UserRole.RECEPTION) {
      throw new ForbiddenException(`So gestores podem registar documentos de ${LABELS[type].toLowerCase()}`);
    }
  }

  private async validate(dto: StockDocumentDto, user: JwtPayload) {
    this.allow(dto.type, user);
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } });
    if (!warehouse || !canAccessHotel(user, warehouse.hotelId)) {
      throw new NotFoundException('Armazem nao encontrado');
    }
    if (dto.type === StockDocumentType.TRANSFER) {
      const to = dto.toWarehouseId ? await this.prisma.warehouse.findUnique({ where: { id: dto.toWarehouseId } }) : null;
      if (!to || to.id === warehouse.id || to.hotelId !== warehouse.hotelId) {
        throw new BadRequestException('Escolhe outro armazem do mesmo hotel para o destino');
      }
    }
    if (dto.type === StockDocumentType.WASTE && !dto.reason?.trim()) {
      throw new BadRequestException('Indica o motivo da quebra');
    }
    const ids = dto.items.map((item) => item.productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Cada produto so pode aparecer uma vez no documento');
    }
    if (dto.type !== StockDocumentType.INVENTORY && dto.items.some((item) => item.quantity <= 0)) {
      throw new BadRequestException('As quantidades tem de ser maiores que zero');
    }
    const products = await this.prisma.product.findMany({ where: { id: { in: ids }, hotelId: warehouse.hotelId, trackStock: true } });
    if (products.length !== ids.length) {
      throw new BadRequestException('Todos os produtos tem de pertencer ao hotel e controlar stock');
    }
    return warehouse.hotelId;
  }
}

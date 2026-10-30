import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaperWidth, Prisma, StockDocumentStatus, StockDocumentType, StockMovementType, UserRole } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { Ticket } from '../billing/ticket-pdf.service';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { Report, ReportSection } from '../reports/report-model';
import { ReportRenderService } from '../reports/report-render.service';
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
  @IsInt()
  supplierId?: number;

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

export class StockPdfQueryDto {
  @IsOptional()
  @IsEnum(PaperWidth)
  paper?: PaperWidth;
}

export class CountSheetQueryDto extends StockPdfQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  withQuantities?: boolean;
}

const documentInclude = {
  warehouse: { select: { id: true, name: true } },
  toWarehouse: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  items: { include: { product: { select: { id: true, name: true, unit: true, cost: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.StockDocumentInclude;

type FullDocument = Prisma.StockDocumentGetPayload<{ include: typeof documentInclude }>;

const LABELS: Record<StockDocumentType, string> = {
  INVENTORY: 'Inventario',
  WASTE: 'Quebra',
  TRANSFER: 'Transferencia',
  RETURN: 'Devolucao a fornecedor',
};

export const STOCK_PREFIX: Record<StockDocumentType, string> = { INVENTORY: 'INV', WASTE: 'QB', TRANSFER: 'TR', RETURN: 'DV' };

const TIME_ZONE = process.env.AT_TIMEZONE ?? 'Europe/Lisbon';

export function stockDocumentNumber(document: { type: StockDocumentType; id: number; year: number | null; number: number | null }) {
  return document.number ? `${STOCK_PREFIX[document.type]} ${document.year}/${document.number}` : `${STOCK_PREFIX[document.type]} #${document.id}`;
}

function qty(value: Prisma.Decimal.Value) {
  return Number(value.toString()).toLocaleString('pt-PT', { maximumFractionDigits: 3 });
}

@Injectable()
export class StockDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly render: ReportRenderService,
    private readonly audit: AuditService,
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
        ...this.links(dto),
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
          ...this.links(dto),
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
    const year = Number(new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE, year: 'numeric' }).format(new Date()));
    await this.prisma.stockDocumentSeries.upsert({
      where: { hotelId_type_year: { hotelId: document.hotelId, type: document.type, year } },
      create: { hotelId: document.hotelId, type: document.type, year },
      update: {},
    });
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.stockDocument.updateMany({
        where: { id, status: StockDocumentStatus.DRAFT },
        data: { status: StockDocumentStatus.POSTED, postedAt: new Date() },
      });
      if (!count) {
        throw new ConflictException('Este documento ja foi lancado ou cancelado');
      }
      const [series] = await tx.$queryRaw<{ id: number; nextNumber: number }[]>`
        SELECT id, nextNumber FROM stock_document_series
        WHERE hotelId = ${document.hotelId} AND type = ${document.type} AND year = ${year} FOR UPDATE`;
      await tx.stockDocumentSeries.update({ where: { id: series.id }, data: { nextNumber: { increment: 1 } } });
      await tx.stockDocument.update({ where: { id }, data: { year, number: series.nextNumber } });
      const number = stockDocumentNumber({ ...document, year, number: series.nextNumber });

      const items = await tx.stockDocumentItem.findMany({ where: { documentId: id }, orderBy: { id: 'asc' } });
      const productIds = [...new Set(items.map((item) => item.productId))];
      await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`;
      const levels = await tx.$queryRaw<{ productId: number; quantity: Prisma.Decimal }[]>`
        SELECT productId, quantity FROM stock_levels
        WHERE warehouseId = ${document.warehouseId} AND productId IN (${Prisma.join(productIds)}) FOR UPDATE`;
      const onHand = new Map(levels.map((level) => [level.productId, new Prisma.Decimal(level.quantity)]));
      const names = new Map(document.items.map((item) => [item.productId, item.product.name]));
      const withReason = (label: string) => [label, document.reason].filter(Boolean).join(': ').slice(0, 200);

      for (const item of items) {
        const current = onHand.get(item.productId) ?? new Prisma.Decimal(0);
        const move = { productId: item.productId, createdById: user.sub, documentId: id };
        if (document.type === StockDocumentType.INVENTORY) {
          await tx.stockDocumentItem.update({ where: { id: item.id }, data: { previousQuantity: current } });
          const difference = item.quantity.sub(current);
          if (difference.isZero()) continue;
          await this.stock.move(tx, { ...move, warehouseId: document.warehouseId, type: StockMovementType.ADJUSTMENT, quantity: difference, reason: withReason(`Inventario ${number}`) });
        } else if (document.type === StockDocumentType.WASTE) {
          await this.stock.move(tx, { ...move, warehouseId: document.warehouseId, type: StockMovementType.WASTE, quantity: item.quantity.neg(), reason: withReason(`Quebra ${number}`) });
        } else {
          if (current.lessThan(item.quantity)) {
            throw new ConflictException(`So ha ${current.toString()} de ${names.get(item.productId)} em ${document.warehouse.name}`);
          }
          if (document.type === StockDocumentType.RETURN) {
            await this.stock.move(tx, {
              ...move,
              warehouseId: document.warehouseId,
              type: StockMovementType.RETURN,
              quantity: item.quantity.neg(),
              reason: withReason(`Devolucao ${number} a ${document.supplier?.name}`),
            });
            continue;
          }
          const reason = `${document.warehouse.name} -> ${document.toWarehouse?.name} (${number})`;
          const out = await this.stock.move(tx, { ...move, warehouseId: document.warehouseId, type: StockMovementType.TRANSFER_OUT, quantity: item.quantity.neg(), reason });
          await this.stock.move(tx, { ...move, warehouseId: document.toWarehouseId!, type: StockMovementType.TRANSFER_IN, quantity: item.quantity, reason, lots: out.lots });
        }
      }
      await this.audit.log(
        {
          hotelId: document.hotelId,
          userId: user.sub,
          action: 'STOCK_DOCUMENT',
          entity: 'stock_document',
          entityId: id,
          summary: `${LABELS[document.type]} ${number} lancado em ${document.warehouse.name} (${items.length} linha(s))${document.reason ? `: ${document.reason}` : ''}`,
        },
        tx,
      );
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

  async pdf(id: number, paper: PaperWidth, user: JwtPayload) {
    const document = await this.findOne(id, user);
    const report = await this.report(document, user);
    return { buffer: await this.render.pdf(report, paper), name: stockDocumentNumber(document).replace(/[ /#]+/g, '-') };
  }

  async countSheet(warehouseId: number, withQuantities: boolean, paper: PaperWidth, user: JwtPayload) {
    const warehouse = await this.stock.findWarehouse(warehouseId, user);
    const [hotel, operator, products] = await Promise.all([
      this.prisma.hotel.findUniqueOrThrow({ where: { id: warehouse.hotelId } }),
      this.operator(user),
      this.prisma.product.findMany({
        where: { hotelId: warehouse.hotelId, trackStock: true, active: true },
        include: { category: { select: { name: true } }, stockLevels: { where: { warehouseId } } },
        orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
      }),
    ]);
    const blank = '______________';
    const columns = [
      { label: 'Produto', weight: 2.4 },
      { label: 'Categoria', weight: 1.4 },
      { label: 'Unid.', weight: 0.6 },
      ...(withQuantities ? [{ label: 'Sistema', align: 'right' as const, weight: 0.9 }] : []),
      { label: 'Contado', align: 'right' as const, weight: 1.3 },
    ];
    const rows = products.map((product) => [
      product.name,
      product.category?.name ?? '-',
      product.unit,
      ...(withQuantities ? [qty(product.stockLevels[0]?.quantity ?? 0)] : []),
      blank,
    ]);
    const report: Report = {
      key: 'count-sheet',
      title: 'Folha de contagem',
      period: `${warehouse.name} · ${Ticket.day(new Date())}`,
      generatedAt: Ticket.when(new Date()),
      generatedBy: operator,
      hotel,
      sections: [
        { title: 'Artigos a contar', table: { columns, rows, empty: 'Sem artigos com controlo de stock' } },
        { title: 'Contagem', note: 'Contado por: ______________________    Data: ____/____/______    Assinatura: ______________________' },
      ],
    };
    return this.render.pdf(report, paper);
  }

  private async report(document: FullDocument, user: JwtPayload): Promise<Report> {
    const [hotel, operator] = await Promise.all([this.prisma.hotel.findUniqueOrThrow({ where: { id: document.hotelId } }), this.operator(user)]);
    const money = (value: Prisma.Decimal.Value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: hotel.currency }).format(Number(value.toString()));
    const status = { DRAFT: 'Rascunho', POSTED: 'Lancado', CANCELLED: 'Cancelado' }[document.status];
    const kpis = [
      { label: 'Armazem', value: document.warehouse.name },
      ...(document.toWarehouse ? [{ label: 'Destino', value: document.toWarehouse.name }] : []),
      ...(document.supplier ? [{ label: 'Fornecedor', value: document.supplier.name }] : []),
      { label: 'Estado', value: status },
      { label: 'Data', value: Ticket.when(document.postedAt ?? document.createdAt) },
    ];
    let table: ReportSection['table'];
    if (document.type === StockDocumentType.INVENTORY) {
      const lines = document.items.map((item) => {
        const difference = item.previousQuantity === null ? null : item.quantity.sub(item.previousQuantity);
        return { item, difference, value: difference ? toMoney(difference.mul(item.product.cost)) : new Prisma.Decimal(0) };
      });
      table = {
        columns: [
          { label: 'Produto', weight: 2.4 },
          { label: 'Unid.', weight: 0.6 },
          { label: 'Antes', align: 'right', weight: 0.9 },
          { label: 'Contado', align: 'right', weight: 0.9 },
          { label: 'Diferenca', align: 'right', weight: 0.9 },
          { label: 'Valor', align: 'right', weight: 1 },
        ],
        rows: lines.map(({ item, difference, value }) => [
          item.product.name,
          item.product.unit,
          item.previousQuantity === null ? '-' : qty(item.previousQuantity),
          qty(item.quantity),
          difference === null ? '-' : qty(difference),
          difference === null ? '-' : money(value),
        ]),
        totals: ['Total', '', '', '', '', money(sumMoney(lines.map((line) => line.value)))],
      };
    } else {
      const values = document.items.map((item) => toMoney(item.quantity.mul(item.product.cost)));
      table = {
        columns: [
          { label: 'Produto', weight: 2.6 },
          { label: 'Unid.', weight: 0.6 },
          { label: 'Quantidade', align: 'right', weight: 1 },
          { label: 'Custo medio', align: 'right', weight: 1 },
          { label: 'Valor', align: 'right', weight: 1 },
        ],
        rows: document.items.map((item, index) => [item.product.name, item.product.unit, qty(item.quantity), money(item.product.cost), money(values[index])]),
        totals: ['Total', '', qty(document.items.reduce((sum, item) => sum.add(item.quantity), new Prisma.Decimal(0))), '', money(sumMoney(values))],
      };
    }
    const sections: ReportSection[] = [
      { title: 'Documento', kpis },
      { title: 'Artigos', table, note: document.reason ? `Motivo / observacao: ${document.reason}` : undefined },
      { title: 'Validacao', note: 'Responsavel: ______________________    Assinatura: ______________________' },
    ];
    return {
      key: 'stock-document',
      title: `${LABELS[document.type]} ${stockDocumentNumber(document)}`,
      period: `${document.warehouse.name} · ${status.toLowerCase()}`,
      generatedAt: Ticket.when(new Date()),
      generatedBy: operator,
      hotel,
      sections,
    };
  }

  private async operator(user: JwtPayload) {
    return (await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } }))?.name ?? '-';
  }

  private links(dto: StockDocumentDto) {
    return {
      toWarehouseId: dto.type === StockDocumentType.TRANSFER ? dto.toWarehouseId : null,
      supplierId: dto.type === StockDocumentType.RETURN ? dto.supplierId : null,
    };
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
    if (dto.type === StockDocumentType.RETURN) {
      const supplier = dto.supplierId ? await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } }) : null;
      if (!supplier || supplier.hotelId !== warehouse.hotelId) {
        throw new BadRequestException('Escolhe o fornecedor a quem vais devolver');
      }
    }
    if ((dto.type === StockDocumentType.WASTE || dto.type === StockDocumentType.RETURN) && !dto.reason?.trim()) {
      throw new BadRequestException(dto.type === StockDocumentType.WASTE ? 'Indica o motivo da quebra' : 'Indica o motivo da devolucao');
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

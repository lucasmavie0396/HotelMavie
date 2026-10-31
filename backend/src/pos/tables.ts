import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { OrderStatus, Outlet, UserRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles, SalesAccess } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_TABLES_PER_OUTLET = 200;

export class TableQueryDto extends HotelQueryDto {
  @IsOptional()
  @IsEnum(Outlet)
  outlet?: Outlet;
}

export class CreateTablesDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsEnum(Outlet)
  outlet: Outlet;

  @IsInt()
  @Min(1)
  @Max(100)
  count: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  seats?: number;
}

export class UpdateTableDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  number?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  seats?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export function tableLabel(table: { number: number; name: string | null }) {
  return table.name?.trim() || `Mesa ${table.number}`;
}

@Controller('dining-tables')
export class TablesController {
  constructor(private readonly prisma: PrismaService) {}

  @SalesAccess()
  @Get()
  async list(@Query() query: TableQueryDto, @CurrentUser() user: JwtPayload) {
    const tables = await this.prisma.diningTable.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId), outlet: query.outlet },
      include: {
        orders: {
          where: { status: OrderStatus.OPEN },
          select: { id: true, total: true, openedAt: true, items: { where: { voidedAt: null }, select: { sentAt: true } } },
          orderBy: { openedAt: 'asc' },
        },
      },
      orderBy: [{ outlet: 'asc' }, { number: 'asc' }],
    });
    return tables.map(({ orders, ...table }) => {
      const order = orders[0];
      const items = orders.flatMap((open) => open.items);
      return {
        ...table,
        label: tableLabel(table),
        openOrder: order
          ? {
              id: order.id,
              total: sumMoney(orders.map((open) => open.total)),
              openedAt: order.openedAt,
              items: items.length,
              pending: items.filter((item) => !item.sentAt).length,
              checks: orders.length,
            }
          : null,
      };
    });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  async create(@Body() dto: CreateTablesDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, dto.hotelId);
    if (!hotelId) throw new BadRequestException('hotelId e obrigatorio');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hotels WHERE id = ${hotelId} FOR UPDATE`;
      const existing = await tx.diningTable.findMany({ where: { hotelId, outlet: dto.outlet }, select: { number: true } });
      if (existing.length + dto.count > MAX_TABLES_PER_OUTLET) {
        throw new BadRequestException(`Cada ponto de venda pode ter ate ${MAX_TABLES_PER_OUTLET} mesas`);
      }
      const start = existing.reduce((max, table) => Math.max(max, table.number), 0) + 1;
      await tx.diningTable.createMany({
        data: Array.from({ length: dto.count }, (_, index) => ({ hotelId, outlet: dto.outlet, number: start + index, seats: dto.seats ?? 4 })),
      });
      return tx.diningTable.findMany({ where: { hotelId, outlet: dto.outlet, number: { gte: start } }, orderBy: { number: 'asc' } });
    });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTableDto, @CurrentUser() user: JwtPayload) {
    await this.find(id, user);
    return this.prisma.diningTable.update({ where: { id }, data: { ...dto, name: dto.name === undefined ? undefined : dto.name?.trim() || null } });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    await this.find(id, user);
    if (await this.prisma.order.count({ where: { tableId: id, status: OrderStatus.OPEN } })) {
      throw new ConflictException('A mesa tem uma conta aberta: feche-a antes de apagar a mesa');
    }
    await this.prisma.diningTable.delete({ where: { id } });
  }

  private async find(id: number, user: JwtPayload) {
    const table = await this.prisma.diningTable.findUnique({ where: { id } });
    if (!table || !canAccessHotel(user, table.hotelId)) {
      throw new NotFoundException('Mesa nao encontrada');
    }
    return table;
  }
}

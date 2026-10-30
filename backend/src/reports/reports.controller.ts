import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { PaperWidth, Prisma, PurchaseStatus, ReservationStatus, UserRole } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, Length } from 'class-validator';
import type { Response } from 'express';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { todayUtc } from '../common/dates';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { ReportBuilderService, ReportParamsDto } from './report-builder.service';
import { ReportRenderService } from './report-render.service';
import { summaryData } from './report-summary';

class ReportQueryDto extends HotelQueryDto {
  @IsDateString({ strict: true })
  @Length(10, 10)
  from: string;

  @IsDateString({ strict: true })
  @Length(10, 10)
  to: string;
}

class ReportPdfQueryDto extends ReportParamsDto {
  @IsOptional()
  @IsEnum(PaperWidth)
  paper?: PaperWidth;
}

@Controller()
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: ReportBuilderService,
    private readonly render: ReportRenderService,
  ) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('reports/summary')
  summary(@Query() query: ReportQueryDto, @CurrentUser() user: JwtPayload) {
    return summaryData(this.prisma, resolveHotelScope(user, query.hotelId), query.from, query.to);
  }

  @Get('reports/catalog')
  catalog(@CurrentUser() user: JwtPayload) {
    return this.builder.catalog(user);
  }

  @Get('reports/view/:key')
  view(@Param('key') key: string, @Query() query: ReportParamsDto, @CurrentUser() user: JwtPayload) {
    return this.builder.build(key, query, user);
  }

  @Get('reports/view/:key/pdf')
  async pdf(@Param('key') key: string, @Query() { paper, ...query }: ReportPdfQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const report = await this.builder.build(key, query, user);
    const buffer = await this.render.pdf(report, paper ?? PaperWidth.A4);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="relatorio-${report.key}.pdf"`);
    res.send(buffer);
  }

  @Get('notifications')
  async notifications(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    const hotelId = resolveHotelScope(user, query.hotelId);
    const today = todayUtc();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);

    const [pendingOnline, arrivals, overdue, staleCash, products, drafts, expiring] = await Promise.all([
      this.prisma.reservation.count({ where: { hotelId, status: ReservationStatus.PENDING, source: 'ONLINE' } }),
      this.prisma.reservation.count({
        where: { hotelId, checkIn: { lte: today }, checkOut: { gt: today }, status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] } },
      }),
      this.prisma.reservation.count({ where: { hotelId, status: ReservationStatus.CHECKED_IN, checkOut: { lt: today } } }),
      this.prisma.cashSession.count({ where: { closedAt: null, openedAt: { lt: dayAgo }, register: { hotelId } } }),
      this.prisma.product.findMany({
        where: { hotelId, trackStock: true, active: true },
        select: { id: true, name: true, minStock: true, stockLevels: { select: { quantity: true } } },
      }),
      user.role === UserRole.RECEPTION ? 0 : this.prisma.purchase.count({ where: { hotelId, status: { in: [PurchaseStatus.DRAFT, PurchaseStatus.PARTIAL] } } }),
      this.prisma.stockLot.findMany({
        where: { warehouse: { hotelId }, quantity: { gt: 0 }, expiryDate: { lt: new Date(today.getTime() + 7 * 24 * 3600 * 1000) } },
        select: { expiryDate: true, product: { select: { name: true } } },
        orderBy: { expiryDate: 'asc' },
      }),
    ]);
    const expired = expiring.filter((lot) => lot.expiryDate && lot.expiryDate < today);
    const expiringNames = [...new Set(expiring.map((lot) => lot.product.name))];
    const lowStock = products.filter((product) =>
      product.stockLevels.reduce((sum, level) => sum.add(level.quantity), new Prisma.Decimal(0)).lessThan(product.minStock),
    );

    const items = [
      pendingOnline && { kind: 'warning', text: `${pendingOnline} reserva(s) online por confirmar`, link: '/reservas' },
      arrivals && { kind: 'info', text: `${arrivals} chegada(s) por fazer check-in hoje`, link: '/' },
      overdue && { kind: 'danger', text: `${overdue} hospede(s) com a saida ja ultrapassada`, link: '/' },
      staleCash && { kind: 'warning', text: `${staleCash} caixa(s) abertas ha mais de 24h`, link: '/caixa' },
      lowStock.length && {
        kind: 'warning',
        text: `Stock abaixo do minimo: ${lowStock.slice(0, 3).map((p) => p.name).join(', ')}${lowStock.length > 3 ? '...' : ''}`,
        link: '/stocks',
      },
      expiring.length && {
        kind: expired.length ? 'danger' : 'warning',
        text: `${expired.length ? `${expired.length} lote(s) expirado(s)` : 'Validades a expirar em 7 dias'}: ${expiringNames.slice(0, 3).join(', ')}${expiringNames.length > 3 ? '...' : ''}`,
        link: '/stocks',
      },
      drafts && { kind: 'info', text: `${drafts} compra(s) por receber`, link: '/compras' },
    ].filter(Boolean);
    return items;
  }
}

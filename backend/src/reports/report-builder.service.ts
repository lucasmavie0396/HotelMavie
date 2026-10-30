import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CashMovementType,
  ChargeType,
  Hotel,
  InvoiceStatus,
  InvoiceType,
  OrderStatus,
  PaymentMethod,
  Prisma,
  ReceiptStatus,
  ReservationSource,
  ReservationStatus,
  StockDocumentType,
  StockMovementType,
  UserRole,
} from '@prisma/client';
import { stockDocumentNumber } from '../stock/stock-documents.service';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Length } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { paymentLabel } from '../billing/documents.service';
import { Ticket } from '../billing/ticket-pdf.service';
import { addDays, nightsBetween, parseDate, todayUtc } from '../common/dates';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { sumMoney, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { Report, ReportDefinition, ReportSection } from './report-model';
import { reportPeriod, SOLD_STATUSES, summaryData } from './report-summary';

export class ReportParamsDto extends HotelQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  to?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  warehouseId?: number;
}

const MANAGERS: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER];
const EVERYONE: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER, UserRole.RECEPTION];

export const REPORTS: ReportDefinition[] = [
  { key: 'daily', title: 'Relatorio diario', description: 'Fecho do dia: ocupacao, chegadas, saidas, receita, recebimentos, documentos e caixa.', group: 'Operacao', params: 'date', roles: MANAGERS },
  { key: 'guests', title: 'Hospedes em casa', description: 'Lista de hospedes alojados num dia, com documento e nacionalidade.', group: 'Operacao', params: 'date', roles: EVERYONE },
  { key: 'reservations', title: 'Reservas do periodo', description: 'Reservas com entrada no periodo, por estado e origem, com totais e sinais.', group: 'Operacao', params: 'period', roles: EVERYONE },
  { key: 'occupancy', title: 'Ocupacao diaria', description: 'Dia a dia: quartos ocupados, taxa de ocupacao, chegadas, saidas e receita de alojamento.', group: 'Operacao', params: 'period', roles: MANAGERS },
  { key: 'management', title: 'Resumo de gestao', description: 'Ocupacao, ADR, RevPAR, receita por area, pagamentos, faturacao e produtos mais vendidos.', group: 'Gestao', params: 'period', roles: MANAGERS },
  { key: 'sales', title: 'Mapa de faturacao', description: 'Todos os documentos emitidos (FT, FR, NC) e recibos, com base, IVA e totais.', group: 'Financeiro', params: 'period', roles: MANAGERS },
  { key: 'vat', title: 'Mapa de IVA', description: 'Base tributavel e imposto por taxa e por motivo de isencao, com notas de credito deduzidas.', group: 'Financeiro', params: 'period', roles: MANAGERS },
  { key: 'payments', title: 'Recebimentos', description: 'Valores recebidos por tipo de pagamento, com o detalhe de cada pagamento.', group: 'Financeiro', params: 'period', roles: MANAGERS },
  { key: 'cash', title: 'Caixa', description: 'Sessoes de caixa: fundo, recebimentos em numerario, entradas, saidas e diferencas no fecho.', group: 'Financeiro', params: 'period', roles: MANAGERS },
  { key: 'accounts', title: 'Contas correntes', description: 'Divida de clientes por antiguidade (0-30, 31-60, 61-90 e mais de 90 dias).', group: 'Financeiro', params: 'none', roles: MANAGERS },
  { key: 'pos', title: 'Restaurante e bar', description: 'Vendas por produto, categoria e ponto de venda, ticket medio e anulacoes.', group: 'Restauracao e stocks', params: 'period', roles: MANAGERS },
  { key: 'stock', title: 'Existencias', description: 'Quantidades e valor de stock por armazem, com os produtos abaixo do minimo.', group: 'Restauracao e stocks', params: 'stock', roles: MANAGERS },
  { key: 'inventory', title: 'Diferencas de inventario', description: 'Acertos dos inventarios lancados no periodo, por produto, com o valor das faltas e sobras.', group: 'Restauracao e stocks', params: 'period', roles: MANAGERS },
  { key: 'waste', title: 'Quebras e devolucoes', description: 'Quebras por motivo e por produto e devolucoes a fornecedores, ao custo medio.', group: 'Restauracao e stocks', params: 'period', roles: MANAGERS },
  { key: 'expiry', title: 'Validades', description: 'Lotes em stock com a data de validade, assinalando os expirados e os que expiram em 30 dias.', group: 'Restauracao e stocks', params: 'stock', roles: MANAGERS },
];

const CHARGE_LABELS: Record<ChargeType, string> = { ACCOMMODATION: 'Alojamento', RESTAURANT: 'Restaurante', BAR: 'Bar', EXTRA: 'Extras' };
const METHOD_LABELS: Record<PaymentMethod, string> = { CASH: 'Numerario', CARD: 'Cartao', TRANSFER: 'Transferencia', MOBILE: 'Pagamento movel', OTHER: 'Outro' };
const DOC_LABELS: Record<InvoiceType, string> = { INVOICE: 'Fatura (FT)', INVOICE_RECEIPT: 'Fatura-recibo (FR)', CREDIT_NOTE: 'Nota de credito (NC)', RECEIPT: 'Recibo' };
const DOC_SHORT: Record<InvoiceType, string> = { INVOICE: 'FT', INVOICE_RECEIPT: 'FR', CREDIT_NOTE: 'NC', RECEIPT: 'RG' };
const STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmada',
  CHECKED_IN: 'Em casa',
  CHECKED_OUT: 'Saiu',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No-show',
};
const SOURCE_LABELS: Record<ReservationSource, string> = { DESK: 'Balcao', PHONE: 'Telefone', EMAIL: 'Email', ONLINE: 'Online' };
const OUTLET_LABELS: Record<string, string> = { RESTAURANT: 'Restaurante', BAR: 'Bar' };

type Money = Prisma.Decimal | number | string;

function day(date: Date) {
  return date.toISOString().slice(0, 10).split('-').reverse().join('/');
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function qty(value: Money) {
  return Number(value.toString()).toLocaleString('pt-PT', { maximumFractionDigits: 3 });
}

function percent(value: number) {
  return `${value.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}%`;
}

@Injectable()
export class ReportBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  catalog(user: JwtPayload) {
    return REPORTS.filter((report) => report.roles.includes(user.role));
  }

  async build(key: string, params: ReportParamsDto, user: JwtPayload): Promise<Report> {
    const definition = REPORTS.find((report) => report.key === key);
    if (!definition) {
      throw new NotFoundException('Relatorio desconhecido');
    }
    if (!definition.roles.includes(user.role)) {
      throw new ForbiddenException('Sem permissao para este relatorio');
    }
    const hotelId = resolveHotelScope(user, params.hotelId);
    if (!hotelId) {
      throw new BadRequestException('Escolhe o hotel');
    }
    const [hotel, operator] = await Promise.all([
      this.prisma.hotel.findUnique({ where: { id: hotelId } }),
      this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } }),
    ]);
    if (!hotel || !canAccessHotel(user, hotel.id)) {
      throw new NotFoundException('Hotel nao encontrado');
    }
    const money = (value: Money) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: hotel.currency }).format(Number(value.toString()));
    const context = { hotel, money };

    let period: string;
    let sections: ReportSection[];
    if (definition.params === 'period') {
      const from = params.from ?? iso(addDays(todayUtc(), -30));
      const to = params.to ?? iso(todayUtc());
      const range = reportPeriod(from, to);
      period = from === to ? `Dia ${day(range.from)}` : `${day(range.from)} a ${day(addDays(range.to, -1))} (${range.days} dias)`;
      sections = await this.periodReport(key, range, from, to, context);
    } else if (definition.params === 'date') {
      const date = parseDate(params.date ?? iso(todayUtc()));
      period = `Dia ${day(date)}`;
      sections = key === 'daily' ? await this.daily(date, context) : await this.guests(date, context);
    } else if (definition.params === 'stock') {
      const result = key === 'expiry' ? await this.expiry(params.warehouseId, context) : await this.stock(params.warehouseId, context);
      period = `${key === 'expiry' ? 'Lotes' : 'Existencias'} em ${Ticket.when(new Date())} · ${result.warehouse}`;
      sections = result.sections;
    } else {
      period = `Situacao em ${day(todayUtc())}`;
      sections = await this.accounts(context);
    }

    return {
      key,
      title: definition.title,
      period,
      generatedAt: Ticket.when(new Date()),
      generatedBy: operator?.name ?? '-',
      hotel,
      sections,
    };
  }

  private periodReport(key: string, range: { from: Date; to: Date; days: number }, from: string, to: string, context: Context) {
    switch (key) {
      case 'reservations':
        return this.reservations(range, context);
      case 'occupancy':
        return this.occupancy(range, context);
      case 'management':
        return this.management(from, to, context);
      case 'sales':
        return this.sales(range, context);
      case 'vat':
        return this.vat(range, context);
      case 'payments':
        return this.payments(range, context);
      case 'cash':
        return this.cash(range, context);
      case 'inventory':
        return this.inventory(range, context);
      case 'waste':
        return this.waste(range, context);
      default:
        return this.pos(range, context);
    }
  }

  private async daily(date: Date, { hotel, money }: Context): Promise<ReportSection[]> {
    const next = addDays(date, 1);
    const window = { gte: date, lt: next };
    const [rooms, staying, arrivals, departures, charges, payments, invoices, sessions] = await Promise.all([
      this.prisma.room.count({ where: { hotelId: hotel.id } }),
      this.prisma.reservation.count({ where: { hotelId: hotel.id, status: { in: SOLD_STATUSES }, checkIn: { lte: date }, checkOut: { gt: date } } }),
      this.prisma.reservation.findMany({
        where: { hotelId: hotel.id, checkIn: date, status: { notIn: [ReservationStatus.CANCELLED] } },
        include: { guest: true, room: true },
        orderBy: { room: { number: 'asc' } },
      }),
      this.prisma.reservation.findMany({
        where: { hotelId: hotel.id, checkOut: date, status: { notIn: [ReservationStatus.CANCELLED, ReservationStatus.NO_SHOW] } },
        include: { guest: true, room: true },
        orderBy: { room: { number: 'asc' } },
      }),
      this.prisma.charge.groupBy({ by: ['type'], where: { hotelId: hotel.id, createdAt: window }, _sum: { total: true }, _count: { _all: true } }),
      this.prisma.payment.findMany({ where: { hotelId: hotel.id, createdAt: window }, include: { paymentType: { select: { name: true } } } }),
      this.prisma.invoice.groupBy({ by: ['type'], where: { hotelId: hotel.id, issuedAt: window }, _sum: { grossTotal: true }, _count: { _all: true } }),
      this.prisma.cashSession.findMany({
        where: { register: { hotelId: hotel.id }, OR: [{ openedAt: window }, { closedAt: window }] },
        include: { register: true, openedBy: { select: { name: true } } },
        orderBy: { openedAt: 'asc' },
      }),
    ]);
    const revenue = sumMoney(charges.map((row) => row._sum.total ?? 0));
    const received = sumMoney(payments.map((payment) => payment.amount));
    const byType = this.groupPayments(payments);
    const stayRows = (list: typeof arrivals) =>
      list.map((reservation) => [
        reservation.room.number,
        `${reservation.guest.firstName} ${reservation.guest.lastName}`,
        reservation.code,
        String(nightsBetween(reservation.checkIn, reservation.checkOut)),
        STATUS_LABELS[reservation.status],
      ]);
    const stayColumns = [
      { label: 'Quarto', weight: 0.8 },
      { label: 'Hospede', weight: 2.4 },
      { label: 'Reserva', weight: 1.3 },
      { label: 'Noites', align: 'right' as const, weight: 0.7 },
      { label: 'Estado', weight: 1.1 },
    ];
    return [
      {
        title: 'Indicadores do dia',
        kpis: [
          { label: 'Ocupacao', value: rooms ? percent((staying / rooms) * 100) : '0%' },
          { label: 'Quartos ocupados', value: `${staying} de ${rooms}` },
          { label: 'Chegadas', value: String(arrivals.length) },
          { label: 'Saidas', value: String(departures.length) },
          { label: 'Receita lancada', value: money(revenue) },
          { label: 'Recebido', value: money(received) },
          { label: 'Documentos emitidos', value: String(invoices.reduce((sum, row) => sum + row._count._all, 0)) },
          { label: 'Sessoes de caixa', value: String(sessions.length) },
        ],
      },
      { title: 'Chegadas', table: { columns: stayColumns, rows: stayRows(arrivals), empty: 'Sem chegadas neste dia' } },
      { title: 'Saidas', table: { columns: stayColumns, rows: stayRows(departures), empty: 'Sem saidas neste dia' } },
      {
        title: 'Receita lancada por area',
        table: {
          columns: [{ label: 'Area', weight: 2 }, { label: 'Lancamentos', align: 'right', weight: 1 }, { label: 'Total', align: 'right', weight: 1.3 }],
          rows: charges.map((row) => [CHARGE_LABELS[row.type], String(row._count._all), money(row._sum.total ?? 0)]),
          totals: ['Total', String(charges.reduce((sum, row) => sum + row._count._all, 0)), money(revenue)],
          empty: 'Sem lancamentos',
        },
      },
      {
        title: 'Recebimentos por tipo de pagamento',
        table: {
          columns: [{ label: 'Tipo de pagamento', weight: 2 }, { label: 'N.o', align: 'right', weight: 0.8 }, { label: 'Total', align: 'right', weight: 1.3 }],
          rows: byType.map((row) => [row.name, String(row.count), money(row.total)]),
          totals: ['Total', String(payments.length), money(received)],
          empty: 'Sem recebimentos',
        },
      },
      {
        title: 'Documentos emitidos',
        table: {
          columns: [{ label: 'Documento', weight: 2 }, { label: 'N.o', align: 'right', weight: 0.8 }, { label: 'Total', align: 'right', weight: 1.3 }],
          rows: invoices.map((row) => [DOC_LABELS[row.type], String(row._count._all), money(row._sum.grossTotal ?? 0)]),
          empty: 'Sem documentos',
        },
      },
      {
        title: 'Caixa',
        table: {
          columns: [
            { label: 'Caixa', weight: 1.4 },
            { label: 'Abertura', weight: 1.4 },
            { label: 'Fecho', weight: 1.4 },
            { label: 'Operador', weight: 1.4 },
            { label: 'Contado', align: 'right', weight: 1.1 },
            { label: 'Diferenca', align: 'right', weight: 1.1 },
          ],
          rows: sessions.map((session) => [
            session.register.name,
            Ticket.when(session.openedAt),
            session.closedAt ? Ticket.when(session.closedAt) : 'aberta',
            session.openedBy?.name ?? '-',
            session.countedAmount ? money(session.countedAmount) : '-',
            session.difference ? money(session.difference) : '-',
          ]),
          empty: 'Sem movimento de caixa',
        },
      },
    ];
  }

  private async guests(date: Date, { hotel }: Context): Promise<ReportSection[]> {
    const reservations = await this.prisma.reservation.findMany({
      where: {
        hotelId: hotel.id,
        status: { in: [ReservationStatus.CHECKED_IN, ReservationStatus.CHECKED_OUT] },
        checkIn: { lte: date },
        checkOut: { gt: date },
      },
      include: { guest: true, room: true, companions: { orderBy: { id: 'asc' } } },
      orderBy: { room: { number: 'asc' } },
    });
    const people = reservations.reduce((sum, reservation) => sum + reservation.adults + reservation.children, 0);
    const documentOf = (person: { documentType: string | null; documentNumber: string | null }) =>
      [person.documentType, person.documentNumber].filter(Boolean).join(' ') || '-';
    const rows = reservations.flatMap((reservation) => [
      [
        reservation.room.number,
        `${reservation.guest.firstName} ${reservation.guest.lastName}`,
        reservation.guest.nationality ?? '-',
        documentOf(reservation.guest),
        day(reservation.checkIn),
        day(reservation.checkOut),
        String(reservation.adults + reservation.children),
      ],
      ...reservation.companions.map((companion) => [
        '',
        `  + ${companion.firstName} ${companion.lastName}${companion.isChild ? ' (crianca)' : ''}`,
        companion.nationality ?? '-',
        documentOf(companion),
        companion.birthDate ? `Nasc. ${day(companion.birthDate)}` : '',
        '',
        '',
      ]),
    ]);
    const missing = people - reservations.reduce((sum, reservation) => sum + 1 + reservation.companions.length, 0);
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Quartos ocupados', value: String(reservations.length) },
          { label: 'Pessoas', value: String(people) },
          { label: 'Adultos', value: String(reservations.reduce((sum, reservation) => sum + reservation.adults, 0)) },
          { label: 'Criancas', value: String(reservations.reduce((sum, reservation) => sum + reservation.children, 0)) },
        ],
      },
      {
        title: 'Hospedes alojados',
        table: {
          columns: [
            { label: 'Quarto', weight: 0.7 },
            { label: 'Hospede', weight: 2.2 },
            { label: 'Nacionalidade', weight: 1.2 },
            { label: 'Documento', weight: 1.6 },
            { label: 'Entrada', weight: 1 },
            { label: 'Saida', weight: 1 },
            { label: 'Pessoas', align: 'right', weight: 0.7 },
          ],
          rows,
          totals: ['Total', `${reservations.length} quartos`, '', '', '', '', String(people)],
          empty: 'Nenhum hospede alojado neste dia',
        },
        note: missing > 0 ? `Faltam os dados de ${missing} acompanhante(s): registe-os na reserva.` : undefined,
      },
    ];
  }

  private async reservations(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const reservations = await this.prisma.reservation.findMany({
      where: { hotelId: hotel.id, checkIn: { gte: range.from, lt: range.to } },
      include: { guest: true, room: true },
      orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
    });
    const active = reservations.filter((reservation) => reservation.status !== ReservationStatus.CANCELLED && reservation.status !== ReservationStatus.NO_SHOW);
    const byStatus = new Map<ReservationStatus, { count: number; total: Prisma.Decimal }>();
    const bySource = new Map<ReservationSource, number>();
    for (const reservation of reservations) {
      const current = byStatus.get(reservation.status) ?? { count: 0, total: new Prisma.Decimal(0) };
      byStatus.set(reservation.status, { count: current.count + 1, total: current.total.add(reservation.totalAmount) });
      bySource.set(reservation.source, (bySource.get(reservation.source) ?? 0) + 1);
    }
    const total = sumMoney(active.map((reservation) => reservation.totalAmount));
    const deposits = sumMoney(active.filter((reservation) => reservation.depositPaymentId).map((reservation) => reservation.depositAmount ?? 0));
    const nights = active.reduce((sum, reservation) => sum + nightsBetween(reservation.checkIn, reservation.checkOut), 0);
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Reservas', value: String(reservations.length) },
          { label: 'Ativas', value: String(active.length) },
          { label: 'Noites', value: String(nights) },
          { label: 'Valor (ativas)', value: money(total) },
          { label: 'Sinais recebidos', value: money(deposits) },
          { label: 'Canceladas / no-show', value: String(reservations.length - active.length) },
        ],
      },
      {
        title: 'Por estado',
        table: {
          columns: [{ label: 'Estado', weight: 2 }, { label: 'Reservas', align: 'right' }, { label: 'Valor', align: 'right', weight: 1.3 }],
          rows: [...byStatus.entries()].map(([status, row]) => [STATUS_LABELS[status], String(row.count), money(row.total)]),
          empty: 'Sem reservas',
        },
      },
      {
        title: 'Por origem',
        table: {
          columns: [{ label: 'Origem', weight: 2 }, { label: 'Reservas', align: 'right' }, { label: 'Peso', align: 'right' }],
          rows: [...bySource.entries()].map(([source, count]) => [SOURCE_LABELS[source], String(count), percent((count / reservations.length) * 100)]),
          empty: 'Sem reservas',
        },
      },
      {
        title: 'Reservas com entrada no periodo',
        table: {
          columns: [
            { label: 'Reserva', weight: 1.2 },
            { label: 'Hospede', weight: 2 },
            { label: 'Quarto', weight: 0.7 },
            { label: 'Entrada', weight: 1 },
            { label: 'Saida', weight: 1 },
            { label: 'Origem', weight: 0.9 },
            { label: 'Estado', weight: 1 },
            { label: 'Sinal', align: 'right', weight: 1.1 },
            { label: 'Total', align: 'right', weight: 1.2 },
          ],
          rows: reservations.map((reservation) => [
            reservation.code,
            `${reservation.guest.firstName} ${reservation.guest.lastName}`,
            reservation.room.number,
            day(reservation.checkIn),
            day(reservation.checkOut),
            SOURCE_LABELS[reservation.source],
            STATUS_LABELS[reservation.status],
            reservation.depositAmount ? `${money(reservation.depositAmount)}${reservation.depositPaymentId ? '' : ' (por confirmar)'}` : '-',
            money(reservation.totalAmount),
          ]),
          totals: ['Total ativas', `${active.length} reservas`, '', '', '', '', '', money(deposits), money(total)],
          empty: 'Sem reservas com entrada no periodo',
        },
      },
    ];
  }

  private async occupancy(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const [rooms, reservations] = await Promise.all([
      this.prisma.room.count({ where: { hotelId: hotel.id } }),
      this.prisma.reservation.findMany({
        where: { hotelId: hotel.id, status: { in: SOLD_STATUSES }, checkIn: { lt: range.to }, checkOut: { gt: range.from } },
        select: { checkIn: true, checkOut: true, pricePerNight: true, adults: true, children: true },
      }),
    ]);
    let soldNights = 0;
    let revenue = new Prisma.Decimal(0);
    let arrivalsTotal = 0;
    let departuresTotal = 0;
    const rows: string[][] = [];
    for (let index = 0; index < range.days; index++) {
      const date = addDays(range.from, index);
      const staying = reservations.filter((reservation) => reservation.checkIn <= date && reservation.checkOut > date);
      const dayRevenue = sumMoney(staying.map((reservation) => reservation.pricePerNight));
      const arrivals = reservations.filter((reservation) => iso(reservation.checkIn) === iso(date)).length;
      const departures = reservations.filter((reservation) => iso(reservation.checkOut) === iso(date)).length;
      soldNights += staying.length;
      revenue = revenue.add(dayRevenue);
      arrivalsTotal += arrivals;
      departuresTotal += departures;
      rows.push([
        `${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][date.getUTCDay()]} ${day(date)}`,
        String(staying.length),
        rooms ? percent((staying.length / rooms) * 100) : '0%',
        String(staying.reduce((sum, reservation) => sum + reservation.adults + reservation.children, 0)),
        String(arrivals),
        String(departures),
        money(dayRevenue),
      ]);
    }
    const available = rooms * range.days;
    const rate = available ? (soldNights / available) * 100 : 0;
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Taxa de ocupacao', value: percent(rate) },
          { label: 'Noites vendidas', value: `${soldNights} de ${available}` },
          { label: 'Receita de alojamento', value: money(revenue) },
          { label: 'ADR', value: money(soldNights ? revenue.div(soldNights) : 0) },
          { label: 'RevPAR', value: money(available ? revenue.div(available) : 0) },
          { label: 'Quartos', value: String(rooms) },
        ],
      },
      {
        title: 'Ocupacao por dia',
        table: {
          columns: [
            { label: 'Dia', weight: 1.4 },
            { label: 'Ocupados', align: 'right' },
            { label: 'Ocupacao', align: 'right' },
            { label: 'Pessoas', align: 'right' },
            { label: 'Chegadas', align: 'right' },
            { label: 'Saidas', align: 'right' },
            { label: 'Receita', align: 'right', weight: 1.4 },
          ],
          rows,
          totals: ['Total', String(soldNights), percent(rate), '', String(arrivalsTotal), String(departuresTotal), money(revenue)],
        },
        note: 'Receita de alojamento calculada pelo preco por noite das reservas confirmadas, em casa ou terminadas.',
      },
    ];
  }

  private async management(from: string, to: string, { hotel, money }: Context): Promise<ReportSection[]> {
    const data = await summaryData(this.prisma, hotel.id, from, to);
    const revenue = sumMoney(data.revenueByType.map((row) => row.total));
    const paid = sumMoney(data.paymentsByMethod.map((row) => row.total));
    const reservations = data.reservationsBySource.reduce((sum, row) => sum + row.count, 0);
    return [
      {
        title: 'Indicadores',
        kpis: [
          { label: 'Taxa de ocupacao', value: percent(data.occupancy.rate) },
          { label: 'Noites vendidas', value: `${data.occupancy.roomNightsSold} de ${data.occupancy.roomNightsAvailable}` },
          { label: 'Receita de quartos', value: money(data.occupancy.roomRevenue) },
          { label: 'ADR (preco medio)', value: money(data.occupancy.adr) },
          { label: 'RevPAR', value: money(data.occupancy.revpar) },
          { label: 'Receita total lancada', value: money(revenue) },
          { label: 'Food cost', value: percent(data.foodAndBeverage.costPercent) },
          { label: 'Cancelamentos / no-show', value: String(data.cancellations) },
        ],
      },
      {
        title: 'Receita por area',
        table: {
          columns: [{ label: 'Area', weight: 2 }, { label: 'Total', align: 'right' }, { label: 'Peso', align: 'right' }],
          rows: data.revenueByType.map((row) => [CHARGE_LABELS[row.type], money(row.total), percent(revenue.isZero() ? 0 : Number(row.total.div(revenue).mul(100)))]),
          totals: ['Total', money(revenue), '100%'],
          empty: 'Sem receita no periodo',
        },
      },
      {
        title: 'Recebimentos por meio',
        table: {
          columns: [{ label: 'Meio', weight: 2 }, { label: 'N.o', align: 'right' }, { label: 'Total', align: 'right' }],
          rows: data.paymentsByMethod.map((row) => [METHOD_LABELS[row.method], String(row.count), money(row.total)]),
          totals: ['Total', String(data.paymentsByMethod.reduce((sum, row) => sum + row.count, 0)), money(paid)],
          empty: 'Sem recebimentos',
        },
      },
      {
        title: 'Faturacao',
        table: {
          columns: [{ label: 'Documento', weight: 2 }, { label: 'N.o', align: 'right' }, { label: 'IVA', align: 'right' }, { label: 'Total', align: 'right' }],
          rows: data.invoices.map((row) => [DOC_LABELS[row.type], String(row.count), money(row.tax), money(row.total)]),
          empty: 'Sem documentos',
        },
      },
      {
        title: 'Restaurante e bar',
        kpis: [
          { label: 'Vendas F&B', value: money(data.foodAndBeverage.revenue) },
          { label: 'Custo das vendas', value: money(data.foodAndBeverage.costOfSales) },
          { label: 'Food cost', value: percent(data.foodAndBeverage.costPercent) },
        ],
        table: {
          columns: [{ label: 'Produto mais vendido', weight: 2.5 }, { label: 'Qtd', align: 'right' }, { label: 'Total', align: 'right' }],
          rows: data.topProducts.map((row) => [row.name, qty(row.quantity), money(row.total)]),
          empty: 'Sem vendas no periodo',
        },
      },
      {
        title: 'Origem das reservas criadas',
        table: {
          columns: [{ label: 'Origem', weight: 2 }, { label: 'Reservas', align: 'right' }, { label: 'Peso', align: 'right' }],
          rows: data.reservationsBySource.map((row) => [SOURCE_LABELS[row.source], String(row.count), percent((row.count / reservations) * 100)]),
          empty: 'Sem reservas criadas no periodo',
        },
      },
    ];
  }

  private async sales(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const window = { gte: range.from, lt: range.to };
    const [invoices, receipts] = await Promise.all([
      this.prisma.invoice.findMany({ where: { hotelId: hotel.id, issuedAt: window }, orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.receipt.findMany({
        where: { hotelId: hotel.id, issuedAt: window },
        include: { paymentType: { select: { name: true } } },
        orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const sign = (type: InvoiceType) => (type === InvoiceType.CREDIT_NOTE ? -1 : 1);
    const signed = (value: Money, type: InvoiceType) => toMoney(value).mul(sign(type));
    const net = sumMoney(invoices.map((invoice) => signed(invoice.netTotal, invoice.type)));
    const tax = sumMoney(invoices.map((invoice) => signed(invoice.taxTotal, invoice.type)));
    const gross = sumMoney(invoices.map((invoice) => signed(invoice.grossTotal, invoice.type)));
    const byType = new Map<InvoiceType, { count: number; net: Prisma.Decimal; tax: Prisma.Decimal; gross: Prisma.Decimal }>();
    for (const invoice of invoices) {
      const current = byType.get(invoice.type) ?? { count: 0, net: new Prisma.Decimal(0), tax: new Prisma.Decimal(0), gross: new Prisma.Decimal(0) };
      byType.set(invoice.type, {
        count: current.count + 1,
        net: current.net.add(invoice.netTotal),
        tax: current.tax.add(invoice.taxTotal),
        gross: current.gross.add(invoice.grossTotal),
      });
    }
    const activeReceipts = receipts.filter((receipt) => receipt.status === ReceiptStatus.ISSUED);
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Documentos', value: String(invoices.length) },
          { label: 'Base tributavel', value: money(net) },
          { label: 'IVA', value: money(tax) },
          { label: 'Total faturado', value: money(gross) },
          { label: 'Recibos emitidos', value: String(activeReceipts.length) },
          { label: 'Recebido em recibos', value: money(sumMoney(activeReceipts.map((receipt) => receipt.amount))) },
        ],
        note: 'As notas de credito sao deduzidas dos totais.',
      },
      {
        title: 'Por tipo de documento',
        table: {
          columns: [{ label: 'Documento', weight: 2 }, { label: 'N.o', align: 'right', weight: 0.6 }, { label: 'Base', align: 'right' }, { label: 'IVA', align: 'right' }, { label: 'Total', align: 'right' }],
          rows: [...byType.entries()].map(([type, row]) => [DOC_LABELS[type], String(row.count), money(row.net), money(row.tax), money(row.gross)]),
          empty: 'Sem documentos no periodo',
        },
      },
      {
        title: 'Documentos emitidos',
        table: {
          columns: [
            { label: 'Documento', weight: 1.4 },
            { label: 'Data', weight: 0.9 },
            { label: 'Cliente', weight: 2 },
            { label: 'NIF', weight: 1 },
            { label: 'Base', align: 'right', weight: 1 },
            { label: 'IVA', align: 'right', weight: 0.9 },
            { label: 'Total', align: 'right', weight: 1 },
          ],
          rows: invoices.map((invoice) => [
            `${invoice.fullNumber}${invoice.status === InvoiceStatus.CREDITED ? ' (creditada)' : ''}`,
            day(invoice.issuedAt),
            invoice.customerName,
            invoice.customerTaxId ?? 'Cons. final',
            money(signed(invoice.netTotal, invoice.type)),
            money(signed(invoice.taxTotal, invoice.type)),
            money(signed(invoice.grossTotal, invoice.type)),
          ]),
          totals: ['Total', `${invoices.length} doc.`, '', '', money(net), money(tax), money(gross)],
          empty: 'Sem documentos no periodo',
        },
      },
      {
        title: 'Recibos (RG)',
        table: {
          columns: [
            { label: 'Recibo', weight: 1.4 },
            { label: 'Data', weight: 0.9 },
            { label: 'Cliente', weight: 2 },
            { label: 'Pagamento', weight: 1.3 },
            { label: 'Estado', weight: 0.9 },
            { label: 'Valor', align: 'right', weight: 1 },
          ],
          rows: receipts.map((receipt) => [
            receipt.fullNumber,
            day(receipt.issuedAt),
            receipt.customerName,
            paymentLabel(receipt),
            receipt.status === ReceiptStatus.ISSUED ? 'Emitido' : 'Anulado',
            money(receipt.amount),
          ]),
          totals: ['Total emitidos', `${activeReceipts.length} rec.`, '', '', '', money(sumMoney(activeReceipts.map((receipt) => receipt.amount)))],
          empty: 'Sem recibos no periodo',
        },
      },
    ];
  }

  private async vat(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const lines = await this.prisma.invoiceLine.findMany({
      where: { invoice: { hotelId: hotel.id, issuedAt: { gte: range.from, lt: range.to } } },
      select: { taxRate: true, taxCategory: true, exemptionCode: true, exemptionReason: true, netAmount: true, taxAmount: true, grossAmount: true, invoice: { select: { type: true } } },
    });
    const groups = new Map<string, { rate: Prisma.Decimal; category: string; exemption: string; net: Prisma.Decimal; tax: Prisma.Decimal; gross: Prisma.Decimal; lines: number }>();
    for (const line of lines) {
      const factor = line.invoice.type === InvoiceType.CREDIT_NOTE ? -1 : 1;
      const key = `${line.taxRate.toString()}|${line.exemptionCode ?? ''}`;
      const current = groups.get(key) ?? {
        rate: line.taxRate,
        category: line.taxCategory,
        exemption: line.exemptionCode ? `${line.exemptionCode} ${line.exemptionReason ?? ''}`.trim() : '-',
        net: new Prisma.Decimal(0),
        tax: new Prisma.Decimal(0),
        gross: new Prisma.Decimal(0),
        lines: 0,
      };
      current.net = current.net.add(line.netAmount.mul(factor));
      current.tax = current.tax.add(line.taxAmount.mul(factor));
      current.gross = current.gross.add(line.grossAmount.mul(factor));
      current.lines++;
      groups.set(key, current);
    }
    const rows = [...groups.values()].sort((a, b) => b.rate.comparedTo(a.rate));
    const net = sumMoney(rows.map((row) => row.net));
    const tax = sumMoney(rows.map((row) => row.tax));
    const gross = sumMoney(rows.map((row) => row.gross));
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Base tributavel', value: money(net) },
          { label: 'IVA liquidado', value: money(tax) },
          { label: 'Total com IVA', value: money(gross) },
          { label: 'Linhas faturadas', value: String(lines.length) },
        ],
      },
      {
        title: 'IVA por taxa',
        table: {
          columns: [
            { label: 'Taxa', align: 'right', weight: 0.7 },
            { label: 'Categoria', weight: 0.8 },
            { label: 'Isencao', weight: 2.4 },
            { label: 'Linhas', align: 'right', weight: 0.7 },
            { label: 'Base', align: 'right', weight: 1.2 },
            { label: 'IVA', align: 'right', weight: 1.1 },
            { label: 'Total', align: 'right', weight: 1.2 },
          ],
          rows: rows.map((row) => [percent(Number(row.rate)), row.category, row.exemption, String(row.lines), money(row.net), money(row.tax), money(row.gross)]),
          totals: ['Total', '', '', String(lines.length), money(net), money(tax), money(gross)],
          empty: 'Sem documentos no periodo',
        },
        note: 'Inclui faturas, faturas-recibo e notas de credito (deduzidas). Os recibos nao tem IVA proprio.',
      },
    ];
  }

  private async payments(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const payments = await this.prisma.payment.findMany({
      where: { hotelId: hotel.id, createdAt: { gte: range.from, lt: range.to } },
      include: {
        paymentType: { select: { name: true } },
        reservation: { select: { code: true, room: { select: { number: true } } } },
        order: { select: { id: true, tableLabel: true, outlet: true } },
        receipt: { select: { fullNumber: true } },
        invoice: { select: { fullNumber: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const total = sumMoney(payments.map((payment) => payment.amount));
    const refunds = sumMoney(payments.filter((payment) => payment.amount.isNegative()).map((payment) => payment.amount));
    const byType = this.groupPayments(payments);
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Total recebido', value: money(total) },
          { label: 'Pagamentos', value: String(payments.length) },
          { label: 'Devolucoes / estornos', value: money(refunds) },
          { label: 'Em numerario', value: money(sumMoney(payments.filter((payment) => payment.method === PaymentMethod.CASH).map((payment) => payment.amount))) },
        ],
      },
      {
        title: 'Por tipo de pagamento',
        table: {
          columns: [{ label: 'Tipo de pagamento', weight: 2 }, { label: 'N.o', align: 'right', weight: 0.7 }, { label: 'Total', align: 'right' }, { label: 'Peso', align: 'right', weight: 0.8 }],
          rows: byType.map((row) => [row.name, String(row.count), money(row.total), percent(total.isZero() ? 0 : Number(row.total.div(total).mul(100)))]),
          totals: ['Total', String(payments.length), money(total), '100%'],
          empty: 'Sem recebimentos no periodo',
        },
      },
      {
        title: 'Detalhe dos pagamentos',
        table: {
          columns: [
            { label: 'Data', weight: 1.2 },
            { label: 'Tipo', weight: 1.2 },
            { label: 'Origem', weight: 1.6 },
            { label: 'Referencia', weight: 1.2 },
            { label: 'Operador', weight: 1.2 },
            { label: 'Valor', align: 'right', weight: 1 },
          ],
          rows: payments.map((payment) => [
            Ticket.when(payment.createdAt),
            paymentLabel(payment),
            payment.reservation
              ? `Quarto ${payment.reservation.room.number} · ${payment.reservation.code}`
              : payment.order
                ? `${OUTLET_LABELS[payment.order.outlet] ?? payment.order.outlet} · ${payment.order.tableLabel ?? `#${payment.order.id}`}`
                : (payment.receipt?.fullNumber ?? payment.invoice?.fullNumber ?? '-'),
            payment.reference ?? '-',
            payment.createdBy?.name ?? '-',
            money(payment.amount),
          ]),
          totals: ['Total', '', '', '', '', money(total)],
          empty: 'Sem recebimentos no periodo',
        },
      },
    ];
  }

  private async cash(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const sessions = await this.prisma.cashSession.findMany({
      where: { register: { hotelId: hotel.id }, openedAt: { gte: range.from, lt: range.to } },
      include: {
        register: true,
        openedBy: { select: { name: true } },
        closedBy: { select: { name: true } },
        payments: { select: { amount: true } },
        movements: { include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { openedAt: 'asc' },
    });
    const rows = sessions.map((session) => {
      const received = sumMoney(session.payments.map((payment) => payment.amount));
      const inflows = sumMoney(session.movements.filter((movement) => movement.type === CashMovementType.IN).map((movement) => movement.amount));
      const outflows = sumMoney(session.movements.filter((movement) => movement.type === CashMovementType.OUT).map((movement) => movement.amount));
      const expected = session.expectedAmount ?? toMoney(session.openingAmount).add(received).add(inflows).sub(outflows);
      return { session, received, inflows, outflows, expected };
    });
    const differences = sumMoney(rows.map((row) => row.session.difference ?? 0));
    const movements = sessions.flatMap((session) => session.movements.map((movement) => ({ ...movement, register: session.register.name })));
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Sessoes', value: String(sessions.length) },
          { label: 'Abertas', value: String(sessions.filter((session) => !session.closedAt).length) },
          { label: 'Recebido em numerario', value: money(sumMoney(rows.map((row) => row.received))) },
          { label: 'Diferencas no fecho', value: money(differences) },
        ],
      },
      {
        title: 'Sessoes de caixa',
        table: {
          columns: [
            { label: 'Caixa', weight: 1.1 },
            { label: 'Abertura', weight: 1.3 },
            { label: 'Fecho', weight: 1.3 },
            { label: 'Fundo', align: 'right' },
            { label: 'Recebido', align: 'right' },
            { label: 'Entradas', align: 'right' },
            { label: 'Saidas', align: 'right' },
            { label: 'Esperado', align: 'right' },
            { label: 'Contado', align: 'right' },
            { label: 'Diferenca', align: 'right' },
          ],
          rows: rows.map(({ session, received, inflows, outflows, expected }) => [
            session.register.name,
            `${Ticket.when(session.openedAt)} ${session.openedBy?.name ?? ''}`.trim(),
            session.closedAt ? `${Ticket.when(session.closedAt)} ${session.closedBy?.name ?? ''}`.trim() : 'aberta',
            money(session.openingAmount),
            money(received),
            money(inflows),
            money(outflows),
            money(expected),
            session.countedAmount ? money(session.countedAmount) : '-',
            session.difference ? money(session.difference) : '-',
          ]),
          totals: ['Total', '', '', '', money(sumMoney(rows.map((row) => row.received))), money(sumMoney(rows.map((row) => row.inflows))), money(sumMoney(rows.map((row) => row.outflows))), '', '', money(differences)],
          empty: 'Sem sessoes de caixa no periodo',
        },
      },
      {
        title: 'Entradas e saidas manuais',
        table: {
          columns: [
            { label: 'Data', weight: 1.2 },
            { label: 'Caixa', weight: 1 },
            { label: 'Tipo', weight: 0.7 },
            { label: 'Descricao', weight: 2.4 },
            { label: 'Operador', weight: 1.2 },
            { label: 'Valor', align: 'right', weight: 1 },
          ],
          rows: movements.map((movement) => [
            Ticket.when(movement.createdAt),
            movement.register,
            movement.type === CashMovementType.IN ? 'Entrada' : 'Saida',
            movement.description,
            movement.createdBy?.name ?? '-',
            money(movement.type === CashMovementType.IN ? movement.amount : movement.amount.neg()),
          ]),
          empty: 'Sem movimentos manuais',
        },
      },
    ];
  }

  private async accounts({ hotel, money }: Context): Promise<ReportSection[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { hotelId: hotel.id, type: InvoiceType.INVOICE, status: InvoiceStatus.ISSUED },
      include: { receiptLines: { where: { receipt: { status: ReceiptStatus.ISSUED } }, select: { amount: true } } },
      orderBy: { issuedAt: 'asc' },
    });
    const today = todayUtc();
    const open = invoices
      .map((invoice) => ({ invoice, open: toMoney(invoice.grossTotal).sub(sumMoney(invoice.receiptLines.map((line) => line.amount))), days: nightsBetween(new Date(Date.UTC(invoice.issuedAt.getUTCFullYear(), invoice.issuedAt.getUTCMonth(), invoice.issuedAt.getUTCDate())), today) }))
      .filter((row) => row.open.greaterThan(0));
    const bucket = (days: number) => (days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3);
    const customers = new Map<string, { name: string; taxId: string | null; buckets: Prisma.Decimal[]; total: Prisma.Decimal; count: number }>();
    for (const row of open) {
      const key = row.invoice.customerTaxId ? `NIF:${row.invoice.customerTaxId}` : `NOME:${row.invoice.customerName}`;
      const current = customers.get(key) ?? { name: row.invoice.customerName, taxId: row.invoice.customerTaxId, buckets: [0, 0, 0, 0].map(() => new Prisma.Decimal(0)), total: new Prisma.Decimal(0), count: 0 };
      current.buckets[bucket(row.days)] = current.buckets[bucket(row.days)].add(row.open);
      current.total = current.total.add(row.open);
      current.count++;
      customers.set(key, current);
    }
    const list = [...customers.values()].sort((a, b) => b.total.comparedTo(a.total));
    const totals = [0, 1, 2, 3].map((index) => sumMoney(list.map((customer) => customer.buckets[index])));
    const total = sumMoney(list.map((customer) => customer.total));
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Total em divida', value: money(total) },
          { label: 'Clientes', value: String(list.length) },
          { label: 'Faturas por receber', value: String(open.length) },
          { label: 'Vencido ha mais de 90 dias', value: money(totals[3]) },
        ],
      },
      {
        title: 'Antiguidade de saldos por cliente',
        table: {
          columns: [
            { label: 'Cliente', weight: 2.2 },
            { label: 'NIF', weight: 1 },
            { label: '0-30 dias', align: 'right' },
            { label: '31-60', align: 'right' },
            { label: '61-90', align: 'right' },
            { label: '+90', align: 'right' },
            { label: 'Total', align: 'right', weight: 1.1 },
          ],
          rows: list.map((customer) => [customer.name, customer.taxId ?? '-', ...customer.buckets.map((value) => money(value)), money(customer.total)]),
          totals: ['Total', '', ...totals.map((value) => money(value)), money(total)],
          empty: 'Nao ha faturas por receber',
        },
      },
      {
        title: 'Faturas por receber',
        table: {
          columns: [
            { label: 'Fatura', weight: 1.4 },
            { label: 'Data', weight: 0.9 },
            { label: 'Cliente', weight: 2.2 },
            { label: 'Dias', align: 'right', weight: 0.6 },
            { label: 'Valor', align: 'right' },
            { label: 'Em divida', align: 'right' },
          ],
          rows: open.map((row) => [row.invoice.fullNumber, day(row.invoice.issuedAt), row.invoice.customerName, String(row.days), money(row.invoice.grossTotal), money(row.open)]),
          totals: ['Total', '', '', '', '', money(total)],
          empty: 'Nao ha faturas por receber',
        },
      },
    ];
  }

  private async pos(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const window = { gte: range.from, lt: range.to };
    const [orders, voided] = await Promise.all([
      this.prisma.order.findMany({
        where: { hotelId: hotel.id, status: OrderStatus.CLOSED, closedAt: window },
        include: { items: { where: { voidedAt: null }, include: { product: { select: { category: { select: { name: true } } } } } } },
      }),
      this.prisma.orderItem.findMany({
        where: { order: { hotelId: hotel.id }, voidedAt: window },
        include: { voidedBy: { select: { name: true } }, order: { select: { tableLabel: true, id: true, outlet: true } } },
        orderBy: { voidedAt: 'asc' },
      }),
    ]);
    const items = orders.flatMap((order) => order.items);
    const total = sumMoney(items.map((item) => item.total));
    const byProduct = new Map<string, { category: string; quantity: Prisma.Decimal; total: Prisma.Decimal }>();
    const byCategory = new Map<string, { quantity: Prisma.Decimal; total: Prisma.Decimal }>();
    for (const item of items) {
      const category = item.product.category?.name ?? 'Sem categoria';
      const product = byProduct.get(item.description) ?? { category, quantity: new Prisma.Decimal(0), total: new Prisma.Decimal(0) };
      byProduct.set(item.description, { category, quantity: product.quantity.add(item.quantity), total: product.total.add(item.total) });
      const group = byCategory.get(category) ?? { quantity: new Prisma.Decimal(0), total: new Prisma.Decimal(0) };
      byCategory.set(category, { quantity: group.quantity.add(item.quantity), total: group.total.add(item.total) });
    }
    const byOutlet = new Map<string, { orders: number; total: Prisma.Decimal }>();
    for (const order of orders) {
      const current = byOutlet.get(order.outlet) ?? { orders: 0, total: new Prisma.Decimal(0) };
      byOutlet.set(order.outlet, { orders: current.orders + 1, total: current.total.add(sumMoney(order.items.map((item) => item.total))) });
    }
    const share = (value: Prisma.Decimal) => percent(total.isZero() ? 0 : Number(value.div(total).mul(100)));
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Vendas', value: money(total) },
          { label: 'Contas fechadas', value: String(orders.length) },
          { label: 'Ticket medio', value: money(orders.length ? total.div(orders.length) : 0) },
          { label: 'Artigos anulados', value: String(voided.length) },
        ],
      },
      {
        title: 'Por ponto de venda',
        table: {
          columns: [{ label: 'Ponto de venda', weight: 2 }, { label: 'Contas', align: 'right' }, { label: 'Ticket medio', align: 'right' }, { label: 'Total', align: 'right' }],
          rows: [...byOutlet.entries()].map(([outlet, row]) => [OUTLET_LABELS[outlet] ?? outlet, String(row.orders), money(row.orders ? row.total.div(row.orders) : 0), money(row.total)]),
          totals: ['Total', String(orders.length), money(orders.length ? total.div(orders.length) : 0), money(total)],
          empty: 'Sem vendas no periodo',
        },
      },
      {
        title: 'Por categoria',
        table: {
          columns: [{ label: 'Categoria', weight: 2 }, { label: 'Qtd', align: 'right' }, { label: 'Total', align: 'right' }, { label: 'Peso', align: 'right' }],
          rows: [...byCategory.entries()].sort((a, b) => b[1].total.comparedTo(a[1].total)).map(([category, row]) => [category, qty(row.quantity), money(row.total), share(row.total)]),
          totals: ['Total', '', money(total), '100%'],
          empty: 'Sem vendas no periodo',
        },
      },
      {
        title: 'Por produto',
        table: {
          columns: [{ label: 'Produto', weight: 2.4 }, { label: 'Categoria', weight: 1.4 }, { label: 'Qtd', align: 'right', weight: 0.7 }, { label: 'Total', align: 'right' }, { label: 'Peso', align: 'right', weight: 0.7 }],
          rows: [...byProduct.entries()].sort((a, b) => b[1].total.comparedTo(a[1].total)).map(([name, row]) => [name, row.category, qty(row.quantity), money(row.total), share(row.total)]),
          totals: ['Total', '', '', money(total), '100%'],
          empty: 'Sem vendas no periodo',
        },
      },
      {
        title: 'Anulacoes',
        table: {
          columns: [
            { label: 'Data', weight: 1.2 },
            { label: 'Mesa', weight: 1 },
            { label: 'Artigo', weight: 2 },
            { label: 'Motivo', weight: 2 },
            { label: 'Por', weight: 1.1 },
            { label: 'Valor', align: 'right', weight: 0.9 },
          ],
          rows: voided.map((item) => [
            item.voidedAt ? Ticket.when(item.voidedAt) : '-',
            `${OUTLET_LABELS[item.order.outlet] ?? item.order.outlet} ${item.order.tableLabel ?? `#${item.order.id}`}`,
            `${qty(item.quantity)} x ${item.description}`,
            item.voidReason ?? '-',
            item.voidedBy?.name ?? '-',
            money(item.total),
          ]),
          totals: ['Total anulado', '', '', '', '', money(sumMoney(voided.map((item) => item.total)))],
          empty: 'Sem anulacoes no periodo',
        },
      },
    ];
  }

  private async stock(warehouseId: number | undefined, { hotel, money }: Context) {
    const warehouses = await this.prisma.warehouse.findMany({ where: { hotelId: hotel.id, active: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    const chosen = warehouseId ? warehouses.find((warehouse) => warehouse.id === warehouseId) : null;
    if (warehouseId && !chosen) {
      throw new NotFoundException('Armazem nao encontrado');
    }
    const levels = await this.prisma.stockLevel.findMany({
      where: { warehouseId: chosen ? chosen.id : { in: warehouses.map((warehouse) => warehouse.id) }, product: { trackStock: true } },
      include: { product: { include: { category: { select: { name: true } } } }, warehouse: { select: { name: true } } },
      orderBy: [{ product: { name: 'asc' } }],
    });
    const value = (level: (typeof levels)[number]) => toMoney(level.quantity.mul(level.product.cost));
    const total = sumMoney(levels.map(value));
    const low = levels.filter((level) => level.quantity.lessThan(level.product.minStock));
    const row = (level: (typeof levels)[number]) => [
      level.product.name,
      level.product.category?.name ?? '-',
      level.warehouse.name,
      `${qty(level.quantity)} ${level.product.unit}`,
      qty(level.product.minStock),
      money(level.product.cost),
      money(value(level)),
    ];
    const columns = [
      { label: 'Produto', weight: 2.2 },
      { label: 'Categoria', weight: 1.3 },
      { label: 'Armazem', weight: 1.2 },
      { label: 'Quantidade', align: 'right' as const, weight: 1.1 },
      { label: 'Minimo', align: 'right' as const, weight: 0.8 },
      { label: 'Custo medio', align: 'right' as const, weight: 1 },
      { label: 'Valor', align: 'right' as const, weight: 1.1 },
    ];
    return {
      warehouse: chosen ? chosen.name : 'todos os armazens',
      sections: [
        {
          title: 'Resumo',
          kpis: [
            { label: 'Valor em stock', value: money(total) },
            { label: 'Artigos', value: String(levels.length) },
            { label: 'Abaixo do minimo', value: String(low.length) },
            { label: 'Armazens', value: chosen ? '1' : String(warehouses.length) },
          ],
        },
        {
          title: 'Abaixo do minimo',
          table: { columns, rows: low.map(row), empty: 'Nenhum artigo abaixo do minimo' },
        },
        {
          title: 'Existencias',
          table: { columns, rows: levels.map(row), totals: ['Total', '', '', '', '', '', money(total)], empty: 'Sem artigos com controlo de stock' },
          note: 'Valor calculado ao custo medio de cada artigo.',
        },
      ] satisfies ReportSection[],
    };
  }

  private stockValue(movement: { quantity: Prisma.Decimal; unitCost: Prisma.Decimal | null }) {
    return toMoney(movement.quantity.mul(movement.unitCost ?? 0));
  }

  private async inventory(range: { from: Date; to: Date }, { hotel, money }: Context): Promise<ReportSection[]> {
    const movements = await this.prisma.stockMovement.findMany({
      where: { type: StockMovementType.ADJUSTMENT, createdAt: { gte: range.from, lt: range.to }, warehouse: { hotelId: hotel.id }, document: { type: StockDocumentType.INVENTORY } },
      include: { product: { select: { name: true, unit: true } }, warehouse: { select: { name: true } }, document: { select: { id: true, type: true, year: true, number: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const values = movements.map((movement) => this.stockValue(movement));
    const shortage = sumMoney(values.filter((value) => value.isNegative()));
    const surplus = sumMoney(values.filter((value) => value.greaterThan(0)));
    const documents = new Set(movements.map((movement) => movement.documentId));
    const byProduct = new Map<string, { name: string; unit: string; quantity: Prisma.Decimal; value: Prisma.Decimal }>();
    movements.forEach((movement, index) => {
      const current = byProduct.get(movement.product.name) ?? { name: movement.product.name, unit: movement.product.unit, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) };
      byProduct.set(movement.product.name, { ...current, quantity: current.quantity.add(movement.quantity), value: current.value.add(values[index]) });
    });
    const products = [...byProduct.values()].sort((a, b) => a.value.comparedTo(b.value));
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Inventarios', value: String(documents.size) },
          { label: 'Faltas', value: money(shortage) },
          { label: 'Sobras', value: money(surplus) },
          { label: 'Diferenca liquida', value: money(shortage.add(surplus)) },
        ],
      },
      {
        title: 'Por produto',
        table: {
          columns: [{ label: 'Produto', weight: 2.4 }, { label: 'Diferenca', align: 'right', weight: 1 }, { label: 'Valor', align: 'right', weight: 1 }],
          rows: products.map((product) => [product.name, `${qty(product.quantity)} ${product.unit}`, money(product.value)]),
          totals: ['Total', '', money(shortage.add(surplus))],
          empty: 'Sem diferencas de inventario no periodo',
        },
      },
      {
        title: 'Detalhe',
        table: {
          columns: [
            { label: 'Data', weight: 1.1 },
            { label: 'Documento', weight: 1.1 },
            { label: 'Armazem', weight: 1.1 },
            { label: 'Produto', weight: 2 },
            { label: 'Diferenca', align: 'right', weight: 0.9 },
            { label: 'Valor', align: 'right', weight: 1 },
          ],
          rows: movements.map((movement, index) => [
            Ticket.when(movement.createdAt),
            movement.document ? stockDocumentNumber(movement.document) : '-',
            movement.warehouse.name,
            movement.product.name,
            qty(movement.quantity),
            money(values[index]),
          ]),
          empty: 'Sem inventarios lancados no periodo',
        },
        note: 'Valor ao custo medio do produto no momento do acerto.',
      },
    ];
  }

  private async waste(range: { from: Date; to: Date }, { hotel, money }: Context): Promise<ReportSection[]> {
    const movements = await this.prisma.stockMovement.findMany({
      where: { type: { in: [StockMovementType.WASTE, StockMovementType.RETURN] }, createdAt: { gte: range.from, lt: range.to }, warehouse: { hotelId: hotel.id } },
      include: {
        product: { select: { name: true, unit: true } },
        document: { select: { id: true, type: true, year: true, number: true, reason: true, supplier: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const wastes = movements.filter((movement) => movement.type === StockMovementType.WASTE);
    const returns = movements.filter((movement) => movement.type === StockMovementType.RETURN);
    const value = (list: typeof movements) => sumMoney(list.map((movement) => this.stockValue(movement).neg()));
    const group = (list: typeof movements, keyOf: (movement: (typeof movements)[number]) => string) => {
      const groups = new Map<string, { count: number; quantity: Prisma.Decimal; value: Prisma.Decimal }>();
      for (const movement of list) {
        const key = keyOf(movement);
        const current = groups.get(key) ?? { count: 0, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) };
        groups.set(key, { count: current.count + 1, quantity: current.quantity.add(movement.quantity.neg()), value: current.value.add(this.stockValue(movement).neg()) });
      }
      return [...groups.entries()].sort((a, b) => b[1].value.comparedTo(a[1].value));
    };
    const reasonOf = (movement: (typeof movements)[number]) => movement.document?.reason || movement.reason || 'Sem motivo';
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Quebras', value: money(value(wastes)) },
          { label: 'Linhas de quebra', value: String(wastes.length) },
          { label: 'Devolucoes', value: money(value(returns)) },
          { label: 'Linhas devolvidas', value: String(returns.length) },
        ],
      },
      {
        title: 'Quebras por motivo',
        table: {
          columns: [{ label: 'Motivo', weight: 2.6 }, { label: 'Linhas', align: 'right', weight: 0.7 }, { label: 'Valor', align: 'right', weight: 1 }],
          rows: group(wastes, reasonOf).map(([reason, data]) => [reason, String(data.count), money(data.value)]),
          totals: ['Total', String(wastes.length), money(value(wastes))],
          empty: 'Sem quebras no periodo',
        },
      },
      {
        title: 'Quebras por produto',
        table: {
          columns: [{ label: 'Produto', weight: 2.6 }, { label: 'Quantidade', align: 'right', weight: 1 }, { label: 'Valor', align: 'right', weight: 1 }],
          rows: group(wastes, (movement) => `${movement.product.name} (${movement.product.unit})`).map(([name, data]) => [name, qty(data.quantity), money(data.value)]),
          empty: 'Sem quebras no periodo',
        },
      },
      {
        title: 'Devolucoes a fornecedores',
        table: {
          columns: [
            { label: 'Data', weight: 1.1 },
            { label: 'Documento', weight: 1 },
            { label: 'Fornecedor', weight: 1.5 },
            { label: 'Produto', weight: 1.8 },
            { label: 'Quantidade', align: 'right', weight: 0.9 },
            { label: 'Valor', align: 'right', weight: 1 },
          ],
          rows: returns.map((movement) => [
            Ticket.when(movement.createdAt),
            movement.document ? stockDocumentNumber(movement.document) : '-',
            movement.document?.supplier?.name ?? '-',
            movement.product.name,
            qty(movement.quantity.neg()),
            money(this.stockValue(movement).neg()),
          ]),
          totals: ['Total', '', '', '', '', money(value(returns))],
          empty: 'Sem devolucoes no periodo',
        },
        note: 'Valores ao custo medio do produto no momento do movimento.',
      },
    ];
  }

  private async expiry(warehouseId: number | undefined, { hotel }: Context) {
    const warehouses = await this.prisma.warehouse.findMany({ where: { hotelId: hotel.id, active: true } });
    const chosen = warehouseId ? warehouses.find((warehouse) => warehouse.id === warehouseId) : null;
    if (warehouseId && !chosen) {
      throw new NotFoundException('Armazem nao encontrado');
    }
    const lots = await this.prisma.stockLot.findMany({
      where: { warehouseId: chosen ? chosen.id : { in: warehouses.map((warehouse) => warehouse.id) }, quantity: { gt: 0 } },
      include: { product: { select: { name: true, unit: true } }, warehouse: { select: { name: true } } },
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    });
    const today = todayUtc();
    const soon = addDays(today, 30);
    const state = (date: Date | null) => (!date ? 'Sem validade' : date < today ? 'EXPIRADO' : date < soon ? `Expira em ${nightsBetween(today, date)} dia(s)` : 'Ok');
    const expired = lots.filter((lot) => lot.expiryDate && lot.expiryDate < today);
    const expiring = lots.filter((lot) => lot.expiryDate && lot.expiryDate >= today && lot.expiryDate < soon);
    const columns = [
      { label: 'Produto', weight: 2.1 },
      { label: 'Armazem', weight: 1.2 },
      { label: 'Lote', weight: 1 },
      { label: 'Validade', weight: 0.9 },
      { label: 'Quantidade', align: 'right' as const, weight: 0.9 },
      { label: 'Estado', weight: 1.2 },
    ];
    const row = (lot: (typeof lots)[number]) => [
      lot.product.name,
      lot.warehouse.name,
      lot.code ?? '-',
      lot.expiryDate ? day(lot.expiryDate) : '-',
      `${qty(lot.quantity)} ${lot.product.unit}`,
      state(lot.expiryDate),
    ];
    return {
      warehouse: chosen ? chosen.name : 'todos os armazens',
      sections: [
        {
          title: 'Resumo',
          kpis: [
            { label: 'Lotes em stock', value: String(lots.length) },
            { label: 'Expirados', value: String(expired.length) },
            { label: 'Expiram em 30 dias', value: String(expiring.length) },
          ],
        },
        { title: 'Expirados e a expirar', table: { columns, rows: [...expired, ...expiring].map(row), empty: 'Nenhum lote expirado ou a expirar' } },
        { title: 'Todos os lotes', table: { columns, rows: lots.map(row), empty: 'Sem lotes registados (ativa "Lotes e validades" no produto)' } },
      ] satisfies ReportSection[],
    };
  }

  private groupPayments(payments: { amount: Prisma.Decimal; method: PaymentMethod; paymentType?: { name: string } | null }[]) {
    const groups = new Map<string, { name: string; count: number; total: Prisma.Decimal }>();
    for (const payment of payments) {
      const name = paymentLabel(payment);
      const current = groups.get(name) ?? { name, count: 0, total: new Prisma.Decimal(0) };
      groups.set(name, { name, count: current.count + 1, total: current.total.add(payment.amount) });
    }
    return [...groups.values()].sort((a, b) => b.total.comparedTo(a.total));
  }
}

interface Context {
  hotel: Hotel;
  money: (value: Money) => string;
}

type Range = { from: Date; to: Date; days: number };

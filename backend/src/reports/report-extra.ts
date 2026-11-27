import { InvoiceStatus, InvoiceType, OrderStatus, PayrollStatus, Prisma, QuoteStatus, ReceiptStatus, StockDocumentStatus, StockDocumentType } from '@prisma/client';
import { localParts } from '../at/at-format';
import { addDays, localDate, todayUtc } from '../common/dates';
import { sumMoney, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { stockDocumentNumber } from '../stock/stock-documents.service';
import type { Context, Range } from './report-builder.service';
import { ReportSection } from './report-model';

const ZERO = new Prisma.Decimal(0);
const WEEKDAYS = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const OUTLETS: Record<string, string> = { RESTAURANT: 'Restaurante', BAR: 'Bar' };
const STATIONS: Record<string, string> = { KITCHEN: 'Cozinha', BAR: 'Bar', NONE: 'Sem preparacao' };
const QUOTE_STATES: Record<QuoteStatus, string> = { OPEN: 'Em aberto', CONVERTED: 'Convertida', CANCELLED: 'Anulada' };

function localDay(date: Date) {
  return localDate(date).split('-').reverse().join('/');
}

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10).split('-').reverse().join('/');
}

function localTime(date: Date) {
  return localParts(date).dateTime.slice(11, 16);
}

function localStamp(date: Date) {
  return `${localDay(date)} ${localTime(date)}`;
}

function qty(value: Prisma.Decimal.Value) {
  return Number(value.toString()).toLocaleString('pt-PT', { maximumFractionDigits: 3 });
}

function percent(value: number) {
  return `${value.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}%`;
}

function minutes(value: number) {
  return value < 1 ? '< 1 min' : `${value.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} min`;
}

function customerKey(document: { customerTaxId: string | null; customerName: string }) {
  return document.customerTaxId ? `NIF:${document.customerTaxId}` : `NOME:${document.customerName}`;
}

function tableLabel(order: { tableId: number | null; tableLabel: string | null; table: { number: number; name: string | null } | null; roomId: number | null; room?: { number: string } | null }) {
  if (order.table) return order.table.name ? `Mesa ${order.table.number} (${order.table.name})` : `Mesa ${order.table.number}`;
  if (order.roomId) return `Quarto ${order.room?.number ?? ''}`.trim();
  return order.tableLabel ? `Balcao: ${order.tableLabel}` : 'Balcao';
}

export class ExtraReports {
  constructor(private readonly prisma: PrismaService) {}

  async quotes(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const quotes = await this.prisma.quote.findMany({
      where: { hotelId: hotel.id, issuedAt: { gte: range.start, lt: range.end } },
      include: { invoice: { select: { fullNumber: true } } },
      orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
    });
    const today = todayUtc();
    const state = (quote: (typeof quotes)[number]) => (quote.status === QuoteStatus.OPEN && quote.validUntil < today ? 'Expirada' : QUOTE_STATES[quote.status]);
    const groups = new Map<string, { count: number; total: Prisma.Decimal }>();
    for (const quote of quotes) {
      const key = state(quote);
      const row = groups.get(key) ?? { count: 0, total: ZERO };
      groups.set(key, { count: row.count + 1, total: row.total.add(quote.grossTotal) });
    }
    const total = sumMoney(quotes.map((quote) => quote.grossTotal));
    const converted = quotes.filter((quote) => quote.status === QuoteStatus.CONVERTED);
    const decided = quotes.filter((quote) => quote.status !== QuoteStatus.OPEN || quote.validUntil < today).length;
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Cotacoes emitidas', value: `${quotes.length} (${money(total)})` },
          { label: 'Convertidas em fatura', value: `${converted.length} (${money(sumMoney(converted.map((quote) => quote.grossTotal)))})` },
          { label: 'Taxa de conversao', value: percent(decided ? (converted.length / decided) * 100 : 0) },
          { label: 'Em aberto', value: String(quotes.filter((quote) => state(quote) === 'Em aberto').length) },
        ],
      },
      {
        title: 'Por estado',
        table: {
          columns: [{ label: 'Estado', weight: 2 }, { label: 'Cotacoes', align: 'right' }, { label: 'Valor', align: 'right' }],
          rows: [...groups.entries()].map(([name, row]) => [name, String(row.count), money(row.total)]),
          totals: ['Total', String(quotes.length), money(total)],
          empty: 'Sem cotacoes no periodo',
        },
      },
      {
        title: 'Cotacoes do periodo',
        table: {
          columns: [
            { label: 'Cotacao', weight: 0.9 },
            { label: 'Data', weight: 0.8 },
            { label: 'Cliente', weight: 1.8 },
            { label: 'Valida ate', weight: 0.8 },
            { label: 'Estado', weight: 0.9 },
            { label: 'Fatura', weight: 0.9 },
            { label: 'Total', align: 'right' },
          ],
          rows: quotes.map((quote) => [quote.fullNumber, localDay(quote.issuedAt), quote.customerName, utcDay(quote.validUntil), state(quote), quote.invoice?.fullNumber ?? '-', money(quote.grossTotal)]),
          empty: 'Sem cotacoes no periodo',
        },
      },
    ];
  }

  async statements(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const [invoices, notes, receipts] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { hotelId: hotel.id, type: InvoiceType.INVOICE, issuedAt: { lt: range.end } },
        select: { id: true, fullNumber: true, issuedAt: true, customerName: true, customerTaxId: true, grossTotal: true },
      }),
      this.prisma.invoice.findMany({
        where: { hotelId: hotel.id, type: InvoiceType.CREDIT_NOTE, creditOf: { type: InvoiceType.INVOICE }, issuedAt: { lt: range.end } },
        select: { id: true, fullNumber: true, issuedAt: true, customerName: true, customerTaxId: true, grossTotal: true },
      }),
      this.prisma.receipt.findMany({
        where: { hotelId: hotel.id, status: ReceiptStatus.ISSUED, issuedAt: { lt: range.end } },
        select: { id: true, fullNumber: true, issuedAt: true, customerName: true, customerTaxId: true, amount: true },
      }),
    ]);
    type Movement = { key: string; name: string; taxId: string | null; date: Date; document: string; debit: Prisma.Decimal; credit: Prisma.Decimal };
    const movements: Movement[] = [
      ...invoices.map((doc) => ({ key: customerKey(doc), name: doc.customerName, taxId: doc.customerTaxId, date: doc.issuedAt, document: doc.fullNumber, debit: toMoney(doc.grossTotal), credit: ZERO })),
      ...notes.map((doc) => ({ key: customerKey(doc), name: doc.customerName, taxId: doc.customerTaxId, date: doc.issuedAt, document: doc.fullNumber, debit: ZERO, credit: toMoney(doc.grossTotal) })),
      ...receipts.map((doc) => ({ key: customerKey(doc), name: doc.customerName, taxId: doc.customerTaxId, date: doc.issuedAt, document: doc.fullNumber, debit: ZERO, credit: toMoney(doc.amount) })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
    const customers = new Map<string, { name: string; taxId: string | null; opening: Prisma.Decimal; debit: Prisma.Decimal; credit: Prisma.Decimal; lines: Movement[] }>();
    for (const movement of movements) {
      const row = customers.get(movement.key) ?? { name: movement.name, taxId: movement.taxId, opening: ZERO, debit: ZERO, credit: ZERO, lines: [] };
      if (movement.date < range.start) row.opening = row.opening.add(movement.debit).sub(movement.credit);
      else {
        row.debit = row.debit.add(movement.debit);
        row.credit = row.credit.add(movement.credit);
        row.lines.push(movement);
      }
      customers.set(movement.key, row);
    }
    const active = [...customers.values()].filter((row) => row.lines.length || !row.opening.isZero()).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    const detail: string[][] = [];
    for (const row of active) {
      let balance = row.opening;
      detail.push([row.name, 'Saldo inicial', '', '', '', money(balance)]);
      for (const line of row.lines) {
        balance = balance.add(line.debit).sub(line.credit);
        detail.push(['', localDay(line.date), line.document, line.debit.isZero() ? '' : money(line.debit), line.credit.isZero() ? '' : money(line.credit), money(balance)]);
      }
    }
    const closing = (row: (typeof active)[number]) => row.opening.add(row.debit).sub(row.credit);
    return [
      {
        title: 'Resumo por cliente',
        table: {
          columns: [
            { label: 'Cliente', weight: 2 },
            { label: 'NUIT', weight: 0.9 },
            { label: 'Saldo inicial', align: 'right' },
            { label: 'Faturado', align: 'right' },
            { label: 'Creditado e recebido', align: 'right', weight: 1.2 },
            { label: 'Saldo final', align: 'right' },
          ],
          rows: active.map((row) => [row.name, row.taxId ?? '-', money(row.opening), money(row.debit), money(row.credit), money(closing(row))]),
          totals: [
            'Total',
            '',
            money(sumMoney(active.map((row) => row.opening))),
            money(sumMoney(active.map((row) => row.debit))),
            money(sumMoney(active.map((row) => row.credit))),
            money(sumMoney(active.map(closing))),
          ],
          empty: 'Sem movimentos de clientes a credito',
        },
      },
      {
        title: 'Extrato por cliente',
        table: {
          columns: [{ label: 'Cliente', weight: 1.8 }, { label: 'Data', weight: 0.8 }, { label: 'Documento', weight: 1 }, { label: 'Debito', align: 'right' }, { label: 'Credito', align: 'right' }, { label: 'Saldo', align: 'right' }],
          rows: detail,
          empty: 'Sem movimentos de clientes a credito',
        },
        note: 'Debito = faturas a credito (FT). Credito = notas de credito dessas faturas e recibos emitidos. Os recibos anulados nao contam.',
      },
    ];
  }

  async creditInvoices(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const include = {
      receiptLines: { where: { receipt: { status: ReceiptStatus.ISSUED } }, select: { amount: true } },
      creditNotes: { select: { grossTotal: true } },
    } satisfies Prisma.InvoiceInclude;
    const [period, open] = await Promise.all([
      this.prisma.invoice.findMany({ where: { hotelId: hotel.id, type: InvoiceType.INVOICE, issuedAt: { gte: range.start, lt: range.end } }, include, orderBy: { issuedAt: 'asc' } }),
      this.prisma.invoice.findMany({ where: { hotelId: hotel.id, type: InvoiceType.INVOICE, status: InvoiceStatus.ISSUED }, include, orderBy: { issuedAt: 'asc' } }),
    ]);
    const today = todayUtc();
    const amounts = (invoice: (typeof period)[number]) => {
      const credited = sumMoney(invoice.creditNotes.map((note) => note.grossTotal));
      const received = sumMoney(invoice.receiptLines.map((line) => line.amount));
      const due = invoice.status === InvoiceStatus.ISSUED ? Prisma.Decimal.max(toMoney(invoice.grossTotal).sub(credited).sub(received), 0) : ZERO;
      return { credited, received, due };
    };
    const lateDays = (invoice: { dueDate: Date | null }) => (invoice.dueDate && invoice.dueDate < today ? Math.round((today.getTime() - invoice.dueDate.getTime()) / 86_400_000) : 0);
    const overdue = open.filter((invoice) => lateDays(invoice) > 0 && amounts(invoice).due.greaterThan(0));
    const periodDue = sumMoney(period.map((invoice) => amounts(invoice).due));
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Faturas a credito no periodo', value: `${period.length} (${money(sumMoney(period.map((invoice) => invoice.grossTotal)))})` },
          { label: 'Ainda em divida dessas', value: money(periodDue) },
          { label: 'Vencidas hoje (todas as datas)', value: `${overdue.length} (${money(sumMoney(overdue.map((invoice) => amounts(invoice).due)))})` },
        ],
      },
      {
        title: 'Faturas do periodo',
        table: {
          columns: [
            { label: 'Fatura', weight: 0.9 },
            { label: 'Data', weight: 0.8 },
            { label: 'Cliente', weight: 1.8 },
            { label: 'Vencimento', weight: 0.8 },
            { label: 'Total', align: 'right' },
            { label: 'Creditado', align: 'right' },
            { label: 'Recebido', align: 'right' },
            { label: 'Em divida', align: 'right' },
          ],
          rows: period.map((invoice) => {
            const { credited, received, due } = amounts(invoice);
            return [invoice.fullNumber, localDay(invoice.issuedAt), invoice.customerName, invoice.dueDate ? utcDay(invoice.dueDate) : '-', money(invoice.grossTotal), money(credited), money(received), money(due)];
          }),
          totals: ['Total', '', '', '', money(sumMoney(period.map((invoice) => invoice.grossTotal))), '', '', money(periodDue)],
          empty: 'Sem faturas a credito no periodo',
        },
      },
      {
        title: 'Vencidas e por pagar (hoje)',
        table: {
          columns: [{ label: 'Fatura', weight: 0.9 }, { label: 'Cliente', weight: 1.8 }, { label: 'Vencimento', weight: 0.8 }, { label: 'Dias de atraso', align: 'right' }, { label: 'Em divida', align: 'right' }],
          rows: overdue.sort((a, b) => lateDays(b) - lateDays(a)).map((invoice) => [invoice.fullNumber, invoice.customerName, utcDay(invoice.dueDate!), String(lateDays(invoice)), money(amounts(invoice).due)]),
          empty: 'Nenhuma fatura vencida',
        },
        note: 'So aparecem as faturas com vencimento. As faturas sem vencimento contam na antiguidade do relatorio Contas correntes.',
      },
    ];
  }

  async results(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const fromMonth = range.from.getUTCFullYear() * 12 + range.from.getUTCMonth();
    const toMonth = addDays(range.to, -1).getUTCFullYear() * 12 + addDays(range.to, -1).getUTCMonth();
    const [documents, items, expenses, purchases, payrolls] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['type'],
        where: { hotelId: hotel.id, type: { in: [InvoiceType.INVOICE, InvoiceType.INVOICE_RECEIPT, InvoiceType.CREDIT_NOTE] }, issuedAt: { gte: range.start, lt: range.end } },
        _sum: { grossTotal: true, taxTotal: true },
      }),
      this.prisma.orderItem.findMany({
        where: { voidedAt: null, order: { hotelId: hotel.id, status: OrderStatus.CLOSED, closedAt: { gte: range.start, lt: range.end } } },
        select: { quantity: true, product: { select: { cost: true, recipeItems: { select: { quantity: true, ingredient: { select: { cost: true } } } } } } },
      }),
      this.prisma.expense.aggregate({ where: { hotelId: hotel.id, status: 'CONFIRMED', date: { gte: range.from, lt: range.to } }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.purchase.aggregate({
        where: { hotelId: hotel.id, status: { in: ['PARTIAL', 'RECEIVED'] }, receivedAt: { gte: range.start, lt: range.end } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.payrollRun.findMany({ where: { hotelId: hotel.id, status: PayrollStatus.CLOSED }, select: { year: true, month: true, payslips: { select: { grossPay: true, employerSs: true } } } }),
    ]);
    const sign = (type: InvoiceType) => (type === InvoiceType.CREDIT_NOTE ? -1 : 1);
    const gross = documents.reduce((sum, row) => sum.add(toMoney(row._sum.grossTotal ?? 0).mul(sign(row.type))), ZERO);
    const taxes = documents.reduce((sum, row) => sum.add(toMoney(row._sum.taxTotal ?? 0).mul(sign(row.type))), ZERO);
    const net = gross.sub(taxes);
    const cost = items
      .reduce((sum, item) => {
        const unit = item.product.recipeItems.length
          ? item.product.recipeItems.reduce((total, line) => total.add(new Prisma.Decimal(line.quantity).mul(line.ingredient.cost)), ZERO)
          : new Prisma.Decimal(item.product.cost);
        return sum.add(unit.mul(item.quantity));
      }, ZERO)
      .toDecimalPlaces(2);
    const spent = toMoney(expenses._sum.amount ?? 0);
    const salaries = payrolls
      .filter((run) => run.year * 12 + run.month - 1 >= fromMonth && run.year * 12 + run.month - 1 <= toMonth)
      .reduce((sum, run) => sum.add(sumMoney(run.payslips.flatMap((slip) => [slip.grossPay, slip.employerSs]))), ZERO);
    const result = net.sub(cost).sub(spent).sub(salaries);
    return [
      {
        title: 'Demonstracao resumida',
        table: {
          columns: [{ label: 'Rubrica', weight: 2.5 }, { label: 'Valor', align: 'right' }],
          rows: [
            ['Vendas faturadas (com IVA, FT + FR - NC)', money(gross)],
            ['IVA incluido', money(taxes.neg())],
            ['Vendas sem IVA', money(net)],
            ['Custo estimado das vendas do restaurante e bar', money(cost.neg())],
            [`Despesas (${expenses._count._all})`, money(spent.neg())],
            ['Salarios fechados dos meses do periodo (bruto + seguranca social da empresa)', money(salaries.neg())],
          ],
          totals: ['Resultado estimado', money(result)],
        },
        note: 'Custo das vendas: custo medio atual de cada produto vendido (ou da ficha tecnica). O alojamento nao tem custo direto. As compras nao entram no resultado, porque o seu custo entra quando o produto e vendido.',
      },
      {
        title: 'Informativo',
        kpis: [
          { label: 'Compras recebidas (com IVA)', value: `${money(purchases._sum.total ?? 0)} (${purchases._count._all})` },
          { label: 'Margem sobre as vendas', value: percent(net.isZero() ? 0 : Number(result.div(net).mul(100))) },
        ],
      },
    ];
  }

  async kitchen(range: Range, { hotel }: Context): Promise<ReportSection[]> {
    const items = await this.prisma.orderItem.findMany({
      where: { voidedAt: null, sentAt: { gte: range.start, lt: range.end }, order: { hotelId: hotel.id } },
      select: { description: true, productId: true, quantity: true, sentAt: true, readyAt: true, product: { select: { name: true, category: { select: { prepStation: true } } } } },
    });
    const done = items.filter((item) => item.readyAt);
    const wait = (item: (typeof items)[number]) => (item.readyAt!.getTime() - item.sentAt!.getTime()) / 60_000;
    const stats = (list: typeof done) => {
      const values = list.map(wait).sort((a, b) => a - b);
      const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return { count: list.length, average, median: values.length ? values[Math.floor(values.length / 2)] : 0, max: values.length ? values[values.length - 1] : 0 };
    };
    const byStation = new Map<string, typeof done>();
    const byProduct = new Map<number, { name: string; list: typeof done }>();
    for (const item of done) {
      const station = STATIONS[item.product.category?.prepStation ?? 'KITCHEN'];
      byStation.set(station, [...(byStation.get(station) ?? []), item]);
      const row = byProduct.get(item.productId) ?? { name: item.product.name, list: [] };
      row.list.push(item);
      byProduct.set(item.productId, row);
    }
    const all = stats(done);
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Linhas enviadas', value: String(items.length) },
          { label: 'Marcadas como prontas', value: String(done.length) },
          { label: 'Tempo medio', value: minutes(all.average) },
          { label: 'Tempo mais longo', value: minutes(all.max) },
        ],
      },
      {
        title: 'Por estacao',
        table: {
          columns: [{ label: 'Estacao', weight: 1.5 }, { label: 'Linhas', align: 'right' }, { label: 'Media', align: 'right' }, { label: 'Mediana', align: 'right' }, { label: 'Maximo', align: 'right' }],
          rows: [...byStation.entries()].map(([name, list]) => {
            const row = stats(list);
            return [name, String(row.count), minutes(row.average), minutes(row.median), minutes(row.max)];
          }),
          empty: 'Sem linhas marcadas como prontas no ecra da cozinha/bar',
        },
      },
      {
        title: 'Por prato (mais lentos primeiro)',
        table: {
          columns: [{ label: 'Produto', weight: 2 }, { label: 'Linhas', align: 'right' }, { label: 'Media', align: 'right' }, { label: 'Maximo', align: 'right' }],
          rows: [...byProduct.values()]
            .map((row) => ({ name: row.name, ...stats(row.list) }))
            .sort((a, b) => b.average - a.average)
            .map((row) => [row.name, String(row.count), minutes(row.average), minutes(row.max)]),
          empty: 'Sem linhas marcadas como prontas no ecra da cozinha/bar',
        },
        note: 'Tempo entre o envio para a cozinha/bar e o momento em que o ecra da cozinha/bar a marcou como pronta. Linhas anuladas nao contam.',
      },
    ];
  }

  private closedOrders(range: Range, hotelId: number) {
    return this.prisma.order.findMany({
      where: { hotelId, status: OrderStatus.CLOSED, closedAt: { gte: range.start, lt: range.end } },
      include: {
        table: { select: { number: true, name: true } },
        room: { select: { number: true } },
        openedBy: { select: { name: true } },
        payments: { select: { amount: true, method: true, paymentType: { select: { name: true } } } },
        items: { where: { voidedAt: null }, select: { quantity: true } },
      },
      orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async salesHours(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const orders = await this.closedOrders(range, hotel.id);
    const byWeekday = new Map<number, { orders: number; total: Prisma.Decimal; days: Set<string> }>();
    const grid = new Map<string, Prisma.Decimal[]>();
    for (const order of orders) {
      const parts = localParts(order.closedAt!);
      const weekday = new Date(`${parts.date}T00:00:00Z`).getUTCDay();
      const hour = parts.dateTime.slice(11, 13);
      const row = byWeekday.get(weekday) ?? { orders: 0, total: ZERO, days: new Set<string>() };
      row.orders++;
      row.total = row.total.add(order.total);
      row.days.add(parts.date);
      byWeekday.set(weekday, row);
      const cells = grid.get(hour) ?? Array.from({ length: 7 }, () => ZERO);
      cells[weekday] = cells[weekday].add(order.total);
      grid.set(hour, cells);
    }
    const total = sumMoney(orders.map((order) => order.total));
    return [
      {
        title: 'Por dia da semana',
        table: {
          columns: [{ label: 'Dia', weight: 1.2 }, { label: 'Contas', align: 'right' }, { label: 'Ticket medio', align: 'right' }, { label: 'Media por dia', align: 'right' }, { label: 'Total', align: 'right' }],
          rows: WEEK_ORDER.filter((weekday) => byWeekday.has(weekday)).map((weekday) => {
            const row = byWeekday.get(weekday)!;
            return [WEEKDAYS[weekday], String(row.orders), money(row.total.div(row.orders)), money(row.total.div(row.days.size)), money(row.total)];
          }),
          totals: ['Total', String(orders.length), money(orders.length ? total.div(orders.length) : 0), '', money(total)],
          empty: 'Sem vendas no restaurante e bar no periodo',
        },
      },
      {
        title: 'Mapa: hora x dia da semana',
        table: {
          columns: [{ label: 'Hora', weight: 0.7 }, ...WEEK_ORDER.map((weekday) => ({ label: WEEKDAYS[weekday].slice(0, 3), align: 'right' as const })), { label: 'Total', align: 'right' }],
          rows: [...grid.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([hour, cells]) => [`${hour}h`, ...WEEK_ORDER.map((weekday) => (cells[weekday].isZero() ? '-' : money(cells[weekday]))), money(sumMoney(cells))]),
          empty: 'Sem vendas no restaurante e bar no periodo',
        },
        note: 'Pela hora em que a conta foi fechada, no fuso do hotel.',
      },
    ];
  }

  async tables(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const orders = await this.closedOrders(range, hotel.id);
    const rows = new Map<string, { outlet: string; orders: number; total: Prisma.Decimal; minutes: number; sort: number }>();
    for (const order of orders) {
      const label = tableLabel(order);
      const row = rows.get(label) ?? { outlet: OUTLETS[order.outlet] ?? order.outlet, orders: 0, total: ZERO, minutes: 0, sort: order.table?.number ?? (order.roomId ? 100_000 : 200_000) };
      row.orders++;
      row.total = row.total.add(order.total);
      row.minutes += (order.closedAt!.getTime() - order.openedAt.getTime()) / 60_000;
      rows.set(label, row);
    }
    const total = sumMoney(orders.map((order) => order.total));
    return [
      {
        title: 'Por mesa',
        table: {
          columns: [
            { label: 'Mesa / conta', weight: 1.6 },
            { label: 'Ponto de venda', weight: 1 },
            { label: 'Contas', align: 'right' },
            { label: 'Ticket medio', align: 'right' },
            { label: 'Tempo medio', align: 'right' },
            { label: 'Total', align: 'right' },
          ],
          rows: [...rows.entries()]
            .sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0], 'pt'))
            .map(([label, row]) => [label, row.outlet, String(row.orders), money(row.total.div(row.orders)), minutes(row.minutes / row.orders), money(row.total)]),
          totals: ['Total', '', String(orders.length), money(orders.length ? total.div(orders.length) : 0), '', money(total)],
          empty: 'Sem vendas no restaurante e bar no periodo',
        },
        note: 'Tempo medio entre a abertura e o fecho da conta.',
      },
    ];
  }

  async salesList(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const orders = await this.closedOrders(range, hotel.id);
    const paid = (order: (typeof orders)[number]) => {
      const names = [...new Set(order.payments.map((payment) => payment.paymentType?.name ?? payment.method))];
      if (names.length) return names.join(', ');
      return order.reservationId ? 'Conta do quarto' : '-';
    };
    const total = sumMoney(orders.map((order) => order.total));
    return [
      {
        title: 'Lista de vendas',
        table: {
          columns: [
            { label: 'Pedido', weight: 0.6 },
            { label: 'Fecho', weight: 1.1 },
            { label: 'Ponto', weight: 0.9 },
            { label: 'Mesa / conta', weight: 1.3 },
            { label: 'Empregado', weight: 1.2 },
            { label: 'Linhas', align: 'right', weight: 0.6 },
            { label: 'Pagamento', weight: 1.3 },
            { label: 'Total', align: 'right' },
          ],
          rows: orders.map((order) => [
            `#${order.id}`,
            localStamp(order.closedAt!),
            OUTLETS[order.outlet] ?? order.outlet,
            tableLabel(order),
            order.openedBy?.name ?? '-',
            String(order.items.length),
            paid(order),
            money(order.total),
          ]),
          totals: ['Total', `${orders.length} contas`, '', '', '', '', '', money(total)],
          empty: 'Sem vendas no restaurante e bar no periodo',
        },
      },
    ];
  }

  async dailySales(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const [orders, sold, products] = await Promise.all([
      this.closedOrders(range, hotel.id),
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        where: { voidedAt: null, order: { hotelId: hotel.id, status: OrderStatus.CLOSED, closedAt: { gte: range.start, lt: range.end } } },
        _sum: { quantity: true },
      }),
      this.prisma.product.findMany({ where: { hotelId: hotel.id, active: true, sellable: true }, select: { id: true, name: true, price: true, category: { select: { name: true } } }, orderBy: { name: 'asc' } }),
    ]);
    const days = new Map<string, { orders: number; total: Prisma.Decimal }>();
    for (let index = 0; index < range.days; index++) days.set(addDays(range.from, index).toISOString().slice(0, 10), { orders: 0, total: ZERO });
    for (const order of orders) {
      const key = localDate(order.closedAt!);
      const row = days.get(key) ?? { orders: 0, total: ZERO };
      days.set(key, { orders: row.orders + 1, total: row.total.add(order.total) });
    }
    const soldIds = new Set(sold.map((row) => row.productId));
    const unsold = products.filter((product) => !soldIds.has(product.id));
    const total = sumMoney(orders.map((order) => order.total));
    return [
      {
        title: 'Vendas por dia',
        table: {
          columns: [{ label: 'Dia', weight: 1 }, { label: 'Dia da semana', weight: 1 }, { label: 'Contas', align: 'right' }, { label: 'Ticket medio', align: 'right' }, { label: 'Total', align: 'right' }],
          rows: [...days.entries()].map(([date, row]) => [
            date.split('-').reverse().join('/'),
            WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()],
            String(row.orders),
            row.orders ? money(row.total.div(row.orders)) : '-',
            money(row.total),
          ]),
          totals: ['Total', '', String(orders.length), money(orders.length ? total.div(orders.length) : 0), money(total)],
        },
      },
      {
        title: `Produtos sem vendas no periodo (${unsold.length})`,
        table: {
          columns: [{ label: 'Produto', weight: 2 }, { label: 'Categoria', weight: 1.2 }, { label: 'Preco', align: 'right' }],
          rows: unsold.map((product) => [product.name, product.category?.name ?? 'Sem categoria', money(product.price)]),
          empty: 'Todos os produtos ativos tiveram vendas',
        },
      },
    ];
  }

  async options(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const options = await this.prisma.orderItemOption.findMany({
      where: { orderItem: { voidedAt: null, order: { hotelId: hotel.id, status: OrderStatus.CLOSED, closedAt: { gte: range.start, lt: range.end } } } },
      select: { groupName: true, name: true, priceDelta: true, orderItem: { select: { quantity: true, product: { select: { name: true } } } } },
    });
    const rows = new Map<string, { group: string; name: string; quantity: Prisma.Decimal; value: Prisma.Decimal; dishes: Set<string> }>();
    for (const option of options) {
      const key = `${option.groupName}\u0000${option.name}`;
      const row = rows.get(key) ?? { group: option.groupName, name: option.name, quantity: ZERO, value: ZERO, dishes: new Set<string>() };
      row.quantity = row.quantity.add(option.orderItem.quantity);
      row.value = row.value.add(new Prisma.Decimal(option.priceDelta).mul(option.orderItem.quantity));
      row.dishes.add(option.orderItem.product.name);
      rows.set(key, row);
    }
    return [
      {
        title: 'Opcoes e acompanhamentos escolhidos',
        table: {
          columns: [{ label: 'Grupo', weight: 1.2 }, { label: 'Opcao', weight: 1.4 }, { label: 'Pratos', weight: 2 }, { label: 'Quantidade', align: 'right' }, { label: 'Acrescimos', align: 'right' }],
          rows: [...rows.values()]
            .sort((a, b) => a.group.localeCompare(b.group, 'pt') || Number(b.quantity.sub(a.quantity)))
            .map((row) => [row.group, row.name, [...row.dishes].join(', '), qty(row.quantity), money(row.value)]),
          totals: ['Total', '', '', qty(sumMoney([...rows.values()].map((row) => row.quantity))), money(sumMoney([...rows.values()].map((row) => row.value)))],
          empty: 'Sem opcoes escolhidas no periodo',
        },
        note: 'Opcoes das linhas nao anuladas das contas fechadas no periodo.',
      },
    ];
  }

  async voids(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const [items, cancelled, receipts] = await Promise.all([
      this.prisma.orderItem.findMany({
        where: { voidedAt: { gte: range.start, lt: range.end }, order: { hotelId: hotel.id } },
        select: { orderId: true, description: true, quantity: true, total: true, sentAt: true, voidedAt: true, voidReason: true, voidedBy: { select: { name: true } } },
        orderBy: { voidedAt: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { hotelId: hotel.id, status: OrderStatus.CANCELLED, OR: [{ closedAt: { gte: range.start, lt: range.end } }, { closedAt: null, openedAt: { gte: range.start, lt: range.end } }] },
        select: { id: true, outlet: true, openedAt: true, closedAt: true, total: true, tableLabel: true, tableId: true, roomId: true, table: { select: { number: true, name: true } }, openedBy: { select: { name: true } }, notes: true },
        orderBy: { openedAt: 'asc' },
      }),
      this.prisma.receipt.findMany({
        where: { hotelId: hotel.id, status: ReceiptStatus.CANCELLED, cancelledAt: { gte: range.start, lt: range.end } },
        select: { fullNumber: true, customerName: true, amount: true, cancelledAt: true, cancelReason: true },
        orderBy: { cancelledAt: 'asc' },
      }),
    ]);
    const afterSent = items.filter((item) => item.sentAt);
    const itemRows = (list: typeof items) =>
      list.map((item) => [localStamp(item.voidedAt!), `#${item.orderId}`, item.description, qty(item.quantity), money(item.total), item.voidReason ?? '-', item.voidedBy?.name ?? '-']);
    const itemColumns = [
      { label: 'Anulado em', weight: 1.1 },
      { label: 'Pedido', weight: 0.6 },
      { label: 'Produto', weight: 1.6 },
      { label: 'Qtd', align: 'right' as const, weight: 0.5 },
      { label: 'Valor', align: 'right' as const },
      { label: 'Motivo', weight: 1.5 },
      { label: 'Por', weight: 1 },
    ];
    return [
      {
        title: 'Resumo',
        kpis: [
          { label: 'Linhas anuladas', value: `${items.length} (${money(sumMoney(items.map((item) => item.total)))})` },
          { label: 'Depois de enviadas a cozinha/bar', value: `${afterSent.length} (${money(sumMoney(afterSent.map((item) => item.total)))})` },
          { label: 'Contas canceladas', value: `${cancelled.length} (${money(sumMoney(cancelled.map((order) => order.total)))})` },
          { label: 'Recibos anulados', value: `${receipts.length} (${money(sumMoney(receipts.map((receipt) => receipt.amount)))})` },
        ],
      },
      { title: 'Linhas anuladas depois de enviadas', table: { columns: itemColumns, rows: itemRows(afterSent), empty: 'Nenhuma' } },
      { title: 'Linhas anuladas antes de enviar', table: { columns: itemColumns, rows: itemRows(items.filter((item) => !item.sentAt)), empty: 'Nenhuma' } },
      {
        title: 'Contas canceladas',
        table: {
          columns: [{ label: 'Pedido', weight: 0.6 }, { label: 'Aberta em', weight: 1.1 }, { label: 'Ponto', weight: 0.9 }, { label: 'Mesa / conta', weight: 1.3 }, { label: 'Aberta por', weight: 1.1 }, { label: 'Valor', align: 'right' }],
          rows: cancelled.map((order) => [`#${order.id}`, localStamp(order.openedAt), OUTLETS[order.outlet] ?? order.outlet, tableLabel(order), order.openedBy?.name ?? '-', money(order.total)]),
          empty: 'Nenhuma',
        },
      },
      {
        title: 'Recibos anulados',
        table: {
          columns: [{ label: 'Recibo', weight: 0.9 }, { label: 'Anulado em', weight: 1.1 }, { label: 'Cliente', weight: 1.6 }, { label: 'Motivo', weight: 1.6 }, { label: 'Valor', align: 'right' }],
          rows: receipts.map((receipt) => [receipt.fullNumber, localStamp(receipt.cancelledAt!), receipt.customerName, receipt.cancelReason ?? '-', money(receipt.amount)]),
          empty: 'Nenhum',
        },
      },
    ];
  }

  async transfers(range: Range, { hotel, money }: Context): Promise<ReportSection[]> {
    const documents = await this.prisma.stockDocument.findMany({
      where: { hotelId: hotel.id, type: StockDocumentType.TRANSFER, status: StockDocumentStatus.POSTED, postedAt: { gte: range.start, lt: range.end } },
      include: {
        warehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
        createdBy: { select: { name: true } },
        items: { select: { quantity: true, product: { select: { id: true, name: true, unit: true, cost: true } } } },
      },
      orderBy: { postedAt: 'asc' },
    });
    const value = (document: (typeof documents)[number]) => sumMoney(document.items.map((item) => new Prisma.Decimal(item.quantity).mul(item.product.cost)));
    const products = new Map<number, { name: string; unit: string; quantity: Prisma.Decimal; value: Prisma.Decimal }>();
    for (const document of documents) {
      for (const item of document.items) {
        const row = products.get(item.product.id) ?? { name: item.product.name, unit: item.product.unit, quantity: ZERO, value: ZERO };
        products.set(item.product.id, { ...row, quantity: row.quantity.add(item.quantity), value: row.value.add(new Prisma.Decimal(item.quantity).mul(item.product.cost)) });
      }
    }
    return [
      {
        title: 'Transferencias',
        table: {
          columns: [
            { label: 'Documento', weight: 0.9 },
            { label: 'Data', weight: 1 },
            { label: 'De', weight: 1.2 },
            { label: 'Para', weight: 1.2 },
            { label: 'Artigos', align: 'right', weight: 0.6 },
            { label: 'Por', weight: 1 },
            { label: 'Valor', align: 'right' },
          ],
          rows: documents.map((document) => [
            stockDocumentNumber(document),
            localStamp(document.postedAt!),
            document.warehouse.name,
            document.toWarehouse?.name ?? '-',
            String(document.items.length),
            document.createdBy?.name ?? '-',
            money(value(document)),
          ]),
          totals: ['Total', '', '', '', '', '', money(sumMoney(documents.map(value)))],
          empty: 'Sem transferencias no periodo',
        },
      },
      {
        title: 'Por artigo',
        table: {
          columns: [{ label: 'Artigo', weight: 2 }, { label: 'Quantidade', align: 'right' }, { label: 'Valor', align: 'right' }],
          rows: [...products.values()].sort((a, b) => b.value.comparedTo(a.value)).map((row) => [row.name, `${qty(row.quantity)} ${row.unit}`, money(row.value)]),
          empty: 'Sem transferencias no periodo',
        },
        note: 'Valor ao custo medio atual de cada artigo.',
      },
    ];
  }
}

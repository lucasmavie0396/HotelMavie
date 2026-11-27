import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, day, login, TestContext } from './helpers';

type Section = { title: string; kpis?: { label: string; value: string }[]; table?: { rows: string[][]; totals?: string[] } };

describe('Relatorios novos (como no LAMGest)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('cotacoes, faturas a credito, extrato, resultados, vendas, mesas, cozinha, opcoes, anulacoes e transferencias', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = await createUser(ctx.prisma, UserRole.MANAGER, hotel.id);
    const auth = (await login(ctx, manager.email)).auth;
    const prisma = ctx.prisma;

    const iva = await prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'IVA 16%', rate: 16, atCategory: 'NOR' } });
    const kitchen = await prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Pratos', prepStation: 'KITCHEN' } });
    const dish = await prisma.product.create({ data: { hotelId: hotel.id, name: 'Frango assado', price: 500, cost: 200, taxRateId: iva.id, categoryId: kitchen.id } });
    await prisma.product.create({ data: { hotelId: hotel.id, name: 'Prato esquecido', price: 300, taxRateId: iva.id, categoryId: kitchen.id } });
    const table = await prisma.diningTable.create({ data: { hotelId: hotel.id, outlet: 'RESTAURANT', number: 7 } });

    const now = Date.now();
    const order = await prisma.order.create({
      data: { hotelId: hotel.id, outlet: 'RESTAURANT', tableId: table.id, status: 'CLOSED', total: 1000, openedById: manager.user.id, openedAt: new Date(now - 40 * 60_000), closedAt: new Date(now - 60_000) },
    });
    const sold = await prisma.orderItem.create({
      data: { orderId: order.id, productId: dish.id, description: 'Frango assado (Batata frita)', quantity: 2, unitPrice: 500, total: 1000, taxRateId: iva.id, sentAt: new Date(now - 35 * 60_000), readyAt: new Date(now - 23 * 60_000) },
    });
    await prisma.orderItemOption.create({ data: { orderItemId: sold.id, groupName: 'Acompanhamento', name: 'Batata frita', priceDelta: 0 } });
    await prisma.orderItem.create({
      data: { orderId: order.id, productId: dish.id, description: 'Frango assado', quantity: 1, unitPrice: 500, total: 500, sentAt: new Date(now - 30 * 60_000), voidedAt: new Date(now - 20 * 60_000), voidReason: 'Cliente desistiu', voidedById: manager.user.id },
    });
    await prisma.order.create({ data: { hotelId: hotel.id, outlet: 'BAR', status: 'CANCELLED', total: 0, openedById: manager.user.id, openedAt: new Date(now - 10 * 60_000), closedAt: new Date(now - 5 * 60_000) } });

    const quote = await ctx.http().post('/api/quotes').set(auth).send({ hotelId: hotel.id, validUntil: day(10), lines: [{ productId: dish.id, quantity: 4 }] }).expect(201);
    await ctx.http().post('/api/quotes').set(auth).send({ hotelId: hotel.id, validUntil: day(10), lines: [{ productId: dish.id, quantity: 1 }] }).expect(201);
    const invoice = await ctx.http().post(`/api/quotes/${quote.body.id}/convert`).set(auth).send({ customerName: 'Empresa Sigma', customerTaxId: '400000077', dueDate: day(-1) }).expect(201);
    await ctx.http().post('/api/receipts').set(auth).send({ hotelId: hotel.id, method: 'CARD', lines: [{ invoiceId: invoice.body.id, amount: 500 }] }).expect(201);

    const category = await prisma.expenseCategory.create({ data: { hotelId: hotel.id, name: 'Limpeza' } });
    await prisma.expense.create({ data: { hotelId: hotel.id, categoryId: category.id, description: 'Detergente', amount: 300, date: new Date(`${day(0)}T00:00:00Z`) } });

    const main = await prisma.warehouse.create({ data: { hotelId: hotel.id, name: 'Economato' } });
    const bar = await prisma.warehouse.create({ data: { hotelId: hotel.id, name: 'Bar' } });
    await prisma.stockDocument.create({
      data: { hotelId: hotel.id, type: 'TRANSFER', status: 'POSTED', year: 2026, number: 1, warehouseId: main.id, toWarehouseId: bar.id, postedAt: new Date(now - 60_000), items: { create: [{ productId: dish.id, quantity: 3 }] } },
    });

    const view = async (key: string) => {
      const response = await ctx.http().get(`/api/reports/view/${key}`).query({ hotelId: hotel.id, from: day(-1), to: day(1) }).set(auth).expect(200);
      return response.body.sections as Section[];
    };
    const rows = (sections: Section[], title: string) => sections.find((section) => section.title.startsWith(title))!.table!.rows;
    const kpi = (sections: Section[], label: string) => sections[0].kpis!.find((item) => item.label === label)!.value;

    const quotes = await view('quotes');
    expect(kpi(quotes, 'Cotacoes emitidas')).toMatch(/^2 /);
    expect(kpi(quotes, 'Convertidas em fatura')).toMatch(/^1 /);

    const credit = await view('credit-invoices');
    expect(rows(credit, 'Faturas do periodo')[0]).toEqual(expect.arrayContaining([invoice.body.fullNumber, 'Empresa Sigma']));
    expect(rows(credit, 'Vencidas')[0]).toEqual(expect.arrayContaining([invoice.body.fullNumber, '1']));

    const statements = await view('statements');
    const summary = rows(statements, 'Resumo por cliente')[0];
    expect(summary[0]).toBe('Empresa Sigma');
    expect(rows(statements, 'Extrato por cliente').map((row) => row[2])).toEqual(['', invoice.body.fullNumber, expect.stringMatching(/^RG /)]);

    const results = await view('results');
    const lines = Object.fromEntries(rows(results, 'Demonstracao resumida').map((row) => [row[0], row[1]]));
    expect(lines['Vendas faturadas (com IVA, FT + FR - NC)']).toContain('2000');
    expect(lines['Custo estimado das vendas do restaurante e bar']).toContain('400');
    expect(lines['Despesas (1)']).toContain('300');

    expect(rows(await view('daily-sales'), 'Produtos sem vendas').map((row) => row[0])).toEqual(['Prato esquecido']);
    expect(rows(await view('sales-list'), 'Lista de vendas')[0]).toEqual(expect.arrayContaining([`#${order.id}`, 'Mesa 7', manager.user.name]));
    expect(rows(await view('tables'), 'Por mesa')[0]).toEqual(expect.arrayContaining(['Mesa 7', 'Restaurante', '1', '39 min']));
    expect(rows(await view('sales-hours'), 'Por dia da semana')).toHaveLength(1);

    const times = await view('kitchen');
    expect(rows(times, 'Por estacao')[0]).toEqual(['Cozinha', '1', '12 min', '12 min', '12 min']);

    expect(rows(await view('options'), 'Opcoes e acompanhamentos')[0]).toEqual(expect.arrayContaining(['Acompanhamento', 'Batata frita', 'Frango assado', '2']));

    const voids = await view('voids');
    expect(rows(voids, 'Linhas anuladas depois de enviadas')[0]).toEqual(expect.arrayContaining(['Frango assado', 'Cliente desistiu', manager.user.name]));
    expect(rows(voids, 'Contas canceladas')).toHaveLength(1);

    const transfers = await view('transfers');
    expect(rows(transfers, 'Transferencias')[0]).toEqual(expect.arrayContaining(['Economato', 'Bar']));
    expect(rows(transfers, 'Por artigo')[0][0]).toBe('Frango assado');
  });
});

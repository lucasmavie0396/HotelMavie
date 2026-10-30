import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, login, TestContext } from './helpers';

type Kpi = { label: string; value: string };
type Section = { title: string; kpis?: Kpi[]; table?: { rows: string[][]; totals?: string[] } };

describe('Documento de fecho de caixa', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('resume movimentos, vendas, formas de pagamento e produtos por categoria do operador da sessao', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const other = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email)).auth;
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 16 } });
    const drinks = await ctx.prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Bebidas', sortOrder: 1 } });
    const food = await ctx.prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Pratos', sortOrder: 2 } });
    const beer = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Cerveja', price: 2.5, taxRateId: rate.id, categoryId: drinks.id } });
    const dish = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Prato do dia', price: 10, taxRateId: rate.id, categoryId: food.id } });

    const register = await ctx.http().post('/api/cash-registers').set(manager).send({ hotelId: hotel.id, name: 'Bar' }).expect(201);
    const session = await ctx.http().post(`/api/cash-registers/${register.body.id}/open`).set(manager).send({ openingAmount: 50 }).expect(201);

    const order = await ctx.http().post('/api/orders').set(manager).send({ hotelId: hotel.id, outlet: 'BAR', tableLabel: 'Balcao' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(manager).send({ productId: beer.id, quantity: 4 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(manager).send({ productId: dish.id, quantity: 1 }).expect(201);
    await ctx.http()
      .post(`/api/orders/${order.body.id}/close`)
      .set(manager)
      .send({ mode: 'PAY', payments: [{ method: 'CASH', amount: 15, cashSessionId: session.body.id }, { method: 'CARD', amount: 5 }] })
      .expect(200);
    await ctx.http().post(`/api/cash-sessions/${session.body.id}/movements`).set(manager).send({ type: 'OUT', amount: 5, description: 'Gelo' }).expect(201);

    const foreign = await ctx.http().post('/api/orders').set(other).send({ hotelId: hotel.id, outlet: 'BAR' }).expect(201);
    await ctx.http().post(`/api/orders/${foreign.body.id}/items`).set(other).send({ productId: beer.id, quantity: 2 }).expect(201);
    await ctx.http().post(`/api/orders/${foreign.body.id}/close`).set(other).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 5 }] }).expect(200);

    await ctx.http().post(`/api/cash-sessions/${session.body.id}/close`).set(manager).send({ countedAmount: 60 }).expect(200);

    const catalog = await ctx.http().get('/api/reports/catalog').set(manager).expect(200);
    expect(catalog.body.map((report: { key: string }) => report.key)).not.toContain('cash-close');
    await ctx.http().get('/api/reports/view/cash-close').query({ hotelId: hotel.id }).set(manager).expect(400);

    const report = (await ctx.http().get('/api/reports/view/cash-close').query({ sessionId: session.body.id }).set(other).expect(200)).body;
    expect(report.period).toContain('Bar');
    const section = (title: string) => report.sections.find((item: Section) => item.title === title) as Section;
    const kpis = (title: string) => Object.fromEntries((section(title).kpis ?? []).map((kpi) => [kpi.label, kpi.value]));

    expect(kpis('Caixa')['Recebido em numerario']).toContain('15,00');
    expect(kpis('Caixa')['Esperado em caixa']).toContain('60,00');
    expect(kpis('Caixa').Diferenca).toContain('0,00');
    expect(kpis('Resumo de vendas')['Documentos emitidos']).toBe('1');
    expect(kpis('Resumo de vendas')['Total de vendas']).toContain('20,00');

    const payments = section('Formas de pagamento').table!;
    expect(payments.rows).toHaveLength(2);
    expect(payments.totals?.[2]).toContain('20,00');

    expect(section('Vendas por categoria').table!.rows.map((row) => row[0])).toEqual(['Bebidas', 'Pratos']);
    expect(section('Produtos e servicos: Bebidas').table!.rows).toEqual([['Cerveja', '4', expect.stringContaining('10,00')]]);
    expect(section('Produtos e servicos: Pratos').table!.rows).toEqual([['Prato do dia', '1', expect.stringContaining('10,00')]]);

    const movements = section('Movimentos financeiros').table!;
    expect(movements.rows).toHaveLength(3);
    expect(movements.rows.map((row) => row[1])).toEqual(['Recebimento', 'Recebimento', 'Saida de caixa']);
    expect(movements.totals?.[4]).toContain('15,00');

    for (const paper of ['A4', 'MM80']) {
      const pdf = await ctx.http().get('/api/print/pdf').query({ document: 'REPORT', report: 'cash-close', sessionId: session.body.id, hotelId: hotel.id, paper }).set(manager).buffer(true).expect(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    }

    const { hotel: elsewhere } = await createHotel(ctx.prisma);
    const outsider = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, elsewhere.id)).email)).auth;
    await ctx.http().get('/api/reports/view/cash-close').query({ sessionId: session.body.id }).set(outsider).expect(404);
  });
});

import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Despesas', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    auth = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
  });

  afterAll(() => ctx.app.close());

  it('regista despesas, paga pelo caixa, anula com estorno no caixa e mostra no relatorio', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const cash = await ctx.prisma.paymentType.create({ data: { hotelId: hotel.id, name: 'Numerario', kind: 'CASH' } });
    const transfer = await ctx.prisma.paymentType.create({ data: { hotelId: hotel.id, name: 'Transferencia', kind: 'TRANSFER' } });
    const manager = await createUser(ctx.prisma, UserRole.MANAGER, hotel.id);
    const managerAuth = (await login(ctx, manager.email)).auth;
    const reception = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const receptionAuth = (await login(ctx, reception.email)).auth;
    const cashier = await createUser(ctx.prisma, UserRole.CASHIER, hotel.id);
    const cashierAuth = (await login(ctx, cashier.email)).auth;

    await ctx.http().post('/api/expense-categories').set(receptionAuth).send({ hotelId: hotel.id, name: 'Limpeza' }).expect(403);
    const category = await ctx.http().post('/api/expense-categories').set(managerAuth).send({ hotelId: hotel.id, name: 'Limpeza' }).expect(201);
    await ctx.http().post('/api/expense-categories').set(managerAuth).send({ hotelId: hotel.id, name: 'Limpeza' }).expect(409);

    const base = { hotelId: hotel.id, categoryId: category.body.id, date: day(0) };
    await ctx.http().post('/api/expenses').set(receptionAuth).send({ ...base, description: 'Futuro', amount: 10, date: day(2) }).expect(400);
    await ctx.http().post('/api/expenses').set(cashierAuth).send({ ...base, description: 'Lixivia', amount: 10 }).expect(403);
    const paid = await ctx.http().post('/api/expenses').set(receptionAuth).send({ ...base, description: 'Lixivia', amount: 350.5, paymentTypeId: cash.id, documentRef: 'VD 12' }).expect(201);
    expect(paid.body).toMatchObject({ amount: '350.5', status: 'CONFIRMED', documentRef: 'VD 12', paymentType: { name: 'Numerario' } });
    const out = await ctx.prisma.cashMovement.findUniqueOrThrow({ where: { id: paid.body.cashMovementId } });
    expect(out).toMatchObject({ type: 'OUT' });
    expect(out.amount.toString()).toBe('350.5');
    await ctx.http().post('/api/expenses').set(receptionAuth).send({ ...base, description: 'Detergente', amount: 1000, paymentTypeId: transfer.id }).expect(201);

    await ctx.http().post(`/api/expenses/${paid.body.id}/void`).set(receptionAuth).send({ reason: 'Erro' }).expect(403);
    const voided = await ctx.http().post(`/api/expenses/${paid.body.id}/void`).set(managerAuth).send({ reason: 'Registada duas vezes' }).expect(200);
    expect(voided.body).toMatchObject({ status: 'VOIDED', voidReason: 'Registada duas vezes' });
    expect(await ctx.prisma.cashMovement.count({ where: { type: 'IN', description: { contains: `despesa #${paid.body.id}` } } })).toBe(1);
    await ctx.http().post(`/api/expenses/${paid.body.id}/void`).set(managerAuth).send({ reason: 'De novo' }).expect(400);

    const list = await ctx.http().get('/api/expenses').query({ hotelId: hotel.id, status: 'CONFIRMED' }).set(receptionAuth).expect(200);
    expect(list.body).toHaveLength(1);
    const report = await ctx.http().get('/api/reports/view/expenses').query({ hotelId: hotel.id, from: day(-1), to: day(1) }).set(managerAuth).expect(200);
    expect(report.body.sections[0].kpis[0].value).toContain('1000');
    expect(report.body.sections[1].table.rows[0]).toEqual(expect.arrayContaining(['Limpeza', '1']));
  });
});

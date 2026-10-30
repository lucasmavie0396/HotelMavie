import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, login, TestContext } from './helpers';

describe('Mesas', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('cria mesas numeradas por ponto de venda e abre uma unica conta por mesa', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const reception = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email)).auth;

    const first = await ctx.http().post('/api/dining-tables').set(manager).send({ hotelId: hotel.id, outlet: 'RESTAURANT', count: 5 }).expect(201);
    expect(first.body.map((table: { number: number }) => table.number)).toEqual([1, 2, 3, 4, 5]);
    const more = await ctx.http().post('/api/dining-tables').set(manager).send({ hotelId: hotel.id, outlet: 'RESTAURANT', count: 2, seats: 6 }).expect(201);
    expect(more.body.map((table: { number: number; seats: number }) => [table.number, table.seats])).toEqual([[6, 6], [7, 6]]);
    const bar = await ctx.http().post('/api/dining-tables').set(manager).send({ hotelId: hotel.id, outlet: 'BAR', count: 3 }).expect(201);
    expect(bar.body[0].number).toBe(1);
    await ctx.http().post('/api/dining-tables').set(reception).send({ hotelId: hotel.id, outlet: 'BAR', count: 1 }).expect(403);

    const table3 = first.body[2];
    await ctx.http().patch(`/api/dining-tables/${table3.id}`).set(manager).send({ name: 'Esplanada 3' }).expect(200);
    await ctx.http().patch(`/api/dining-tables/${table3.id}`).set(manager).send({ number: 1 }).expect(409);

    const opened = await ctx.http().post('/api/orders').set(reception).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableId: table3.id }).expect(201);
    expect(opened.body).toMatchObject({ tableId: table3.id, tableLabel: 'Esplanada 3', status: 'OPEN' });
    const again = await ctx.http().post('/api/orders').set(reception).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableId: table3.id }).expect(201);
    expect(again.body.id).toBe(opened.body.id);

    const concurrent = await Promise.all(
      [1, 2, 3].map(() => ctx.http().post('/api/orders').set(reception).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableId: first.body[0].id })),
    );
    expect(new Set(concurrent.map((response) => response.body.id)).size).toBe(1);
    expect((await ctx.http().post('/api/orders').set(reception).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableId: first.body[1].id }).expect(201)).body.tableLabel).toBe('Mesa 2');

    await ctx.http().post('/api/orders').set(reception).send({ hotelId: hotel.id, outlet: 'BAR', tableId: table3.id }).expect(400);

    const list = await ctx.http().get(`/api/dining-tables?hotelId=${hotel.id}&outlet=RESTAURANT`).set(reception).expect(200);
    expect(list.body).toHaveLength(7);
    const busy = list.body.find((table: { id: number }) => table.id === table3.id);
    expect(busy).toMatchObject({ label: 'Esplanada 3', openOrder: { id: opened.body.id } });
    expect(list.body.find((table: { number: number }) => table.number === 5).openOrder).toBeNull();

    await ctx.http().delete(`/api/dining-tables/${table3.id}`).set(manager).expect(409);
    await ctx.http().post(`/api/orders/${opened.body.id}/cancel`).set(manager).expect(200);
    const reopened = await ctx.http().post('/api/orders').set(reception).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableId: table3.id }).expect(201);
    expect(reopened.body.id).not.toBe(opened.body.id);
    await ctx.http().post(`/api/orders/${reopened.body.id}/cancel`).set(manager).expect(200);
    await ctx.http().delete(`/api/dining-tables/${table3.id}`).set(manager).expect(204);

    await ctx.http().patch(`/api/dining-tables/${first.body[4].id}`).set(manager).send({ active: false }).expect(200);
    await ctx.http().post('/api/orders').set(reception).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableId: first.body[4].id }).expect(400);

    const other = await createHotel(ctx.prisma);
    const outsider = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, other.hotel.id)).email)).auth;
    await ctx.http().patch(`/api/dining-tables/${first.body[0].id}`).set(outsider).send({ seats: 2 }).expect(404);
    await ctx.http().post('/api/orders').set(outsider).send({ hotelId: other.hotel.id, outlet: 'RESTAURANT', tableId: first.body[0].id }).expect(400);
  });
});

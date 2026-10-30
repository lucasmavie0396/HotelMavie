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

  it('divide a conta por artigos, transfere para outra mesa e mostra o pedido no ecra da cozinha', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 23 } });
    const kitchen = await ctx.prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Pratos', prepStation: 'KITCHEN' } });
    const drinks = await ctx.prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Bebidas', prepStation: 'BAR' } });
    const dish = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Bitoque', price: 12, taxRateId: rate.id, categoryId: kitchen.id } });
    const beer = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Imperial', price: 2, taxRateId: rate.id, categoryId: drinks.id } });
    const tables = await ctx.http().post('/api/dining-tables').set(manager).send({ hotelId: hotel.id, outlet: 'RESTAURANT', count: 2 }).expect(201);

    const order = await ctx.http().post('/api/orders').set(manager).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableId: tables.body[0].id }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(manager).send({ productId: dish.id, quantity: 2 }).expect(201);
    const full = await ctx.http().post(`/api/orders/${order.body.id}/items`).set(manager).send({ productId: beer.id, quantity: 4 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/send`).set(manager).expect(200);

    const kds = await ctx.http().get('/api/kds').query({ hotelId: hotel.id, station: 'KITCHEN' }).set(manager).expect(200);
    expect(kds.body.pending).toHaveLength(1);
    expect(kds.body.pending[0]).toMatchObject({ orderId: order.body.id, table: 'Mesa 1' });
    expect(kds.body.pending[0].items).toHaveLength(1);
    const dishItem = full.body.items.find((item: { productId: number }) => item.productId === dish.id);
    const beerItem = full.body.items.find((item: { productId: number }) => item.productId === beer.id);
    await ctx.http().post('/api/kds/ready').set(manager).send({ itemIds: [dishItem.id] }).expect(200);
    const after = await ctx.http().get('/api/kds').query({ hotelId: hotel.id, station: 'KITCHEN' }).set(manager).expect(200);
    expect(after.body.pending).toHaveLength(0);
    expect(after.body.done).toHaveLength(1);
    expect((await ctx.http().get('/api/kds').query({ hotelId: hotel.id, station: 'BAR' }).set(manager).expect(200)).body.pending).toHaveLength(1);

    const split = await ctx.http()
      .post(`/api/orders/${order.body.id}/move-items`)
      .set(manager)
      .send({ items: [{ itemId: dishItem.id, quantity: 1 }, { itemId: beerItem.id, quantity: 2 }] })
      .expect(200);
    expect(split.body.from.total).toBe('16');
    expect(split.body.to).toMatchObject({ total: '16', tableId: tables.body[0].id, tableLabel: 'Mesa 1 (conta 2)' });
    expect(split.body.to.items.every((item: { sentAt: string | null }) => item.sentAt)).toBe(true);
    await ctx.http().post(`/api/orders/${order.body.id}/move-items`).set(manager).send({ items: [{ itemId: beerItem.id, quantity: 3 }] }).expect(400);

    const list = await ctx.http().get(`/api/dining-tables?hotelId=${hotel.id}&outlet=RESTAURANT`).set(manager).expect(200);
    expect(list.body[0].openOrder).toMatchObject({ id: order.body.id, total: '32', checks: 2 });

    await ctx.http()
      .post(`/api/orders/${split.body.to.id}/close`)
      .set(manager)
      .send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 8 }, { method: 'MOBILE', amount: 8 }] })
      .expect(200);

    const moved = await ctx.http()
      .post(`/api/orders/${order.body.id}/move-items`)
      .set(manager)
      .send({ toTableId: tables.body[1].id, items: split.body.from.items.filter((item: { voidedAt: string | null }) => !item.voidedAt).map((item: { id: number; quantity: string }) => ({ itemId: item.id, quantity: Number(item.quantity) })) })
      .expect(200);
    expect(moved.body.from.status).toBe('CANCELLED');
    expect(moved.body.to).toMatchObject({ tableId: tables.body[1].id, total: '16', status: 'OPEN' });
    const final = await ctx.http().get(`/api/dining-tables?hotelId=${hotel.id}&outlet=RESTAURANT`).set(manager).expect(200);
    expect(final.body[0].openOrder).toBeNull();
    expect(final.body[1].openOrder).toMatchObject({ total: '16', checks: 1 });
  });
});

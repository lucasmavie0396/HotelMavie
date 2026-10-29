import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const isTicket = (pdf: Buffer) => /\/MediaBox \[0 0 226\.77/.test(pdf.toString('latin1'));

describe('Pedidos a cozinha e bar, anulacoes e taloes', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function setup() {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 23 } });
    const drinks = await ctx.prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Bebidas', prepStation: 'BAR' } });
    const food = await ctx.prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Pratos', prepStation: 'KITCHEN' } });
    const beer = await ctx.prisma.product.create({ data: { hotelId: hotel.id, categoryId: drinks.id, name: 'Cerveja', price: 2.5, taxRateId: rate.id, trackStock: true } });
    const dish = await ctx.prisma.product.create({ data: { hotelId: hotel.id, categoryId: food.id, name: 'Bitoque', price: 12, taxRateId: rate.id } });
    const warehouse = await ctx.prisma.warehouse.create({ data: { hotelId: hotel.id, name: 'Economato', isDefault: true } });
    await ctx.prisma.stockLevel.create({ data: { warehouseId: warehouse.id, productId: beer.id, quantity: 10 } });
    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableLabel: 'Mesa 3' }).expect(201);
    return { hotel, rooms, beer, dish, warehouse, orderId: order.body.id as number };
  }

  const add = (orderId: number, product: { id: number }, quantity = 1, notes?: string) =>
    ctx.http().post(`/api/orders/${orderId}/items`).set(auth).send({ productId: product.id, quantity, notes }).expect(201);

  it('envia so as linhas novas, separadas por cozinha e bar', async () => {
    const { beer, dish, orderId } = await setup();
    await add(orderId, dish, 2, 'mal passado');
    await add(orderId, beer, 2);

    const first = await ctx.http().post(`/api/orders/${orderId}/send`).set(auth).expect(200);
    expect(first.body.stations.sort()).toEqual(['BAR', 'KITCHEN']);
    await ctx.http().post(`/api/orders/${orderId}/send`).set(auth).expect(400);

    const kitchen = await ctx.http().get(`/api/orders/${orderId}/ticket?station=KITCHEN`).set(auth).responseType('blob').expect(200);
    expect(isTicket(kitchen.body)).toBe(true);
    expect(pages(kitchen.body)).toBe(1);
    await ctx.http().get(`/api/orders/${orderId}/ticket?station=BAR`).set(auth).responseType('blob').expect(200);
    await ctx.http().get(`/api/orders/${orderId}/ticket?station=OUTRO`).set(auth).expect(400);

    await add(orderId, dish, 1);
    const second = await ctx.http().post(`/api/orders/${orderId}/send`).set(auth).expect(200);
    expect(second.body.stations).toEqual(['KITCHEN']);
    const items = await ctx.prisma.orderItem.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
    expect(items[0].sentAt!.getTime()).toBe(items[1].sentAt!.getTime());
    expect(items[2].sentAt!.getTime()).toBeGreaterThan(items[0].sentAt!.getTime());
    await ctx.http().get(`/api/orders/${orderId}/ticket?station=BAR&sentAt=${encodeURIComponent(second.body.sentAt)}`).set(auth).expect(404);
  });

  it('linhas enviadas so se anulam com motivo e por gestor, e saem do total, da fatura e do stock', async () => {
    const { hotel, beer, dish, warehouse, orderId } = await setup();
    await add(orderId, dish, 1);
    const withBeer = await add(orderId, beer, 2);
    const beerLine = withBeer.body.items.find((item: { productId: number }) => item.productId === beer.id);
    await ctx.http().post(`/api/orders/${orderId}/send`).set(auth).expect(200);

    await ctx.http().delete(`/api/orders/${orderId}/items/${beerLine.id}`).set(auth).expect(409);
    const staff = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const staffAuth = (await login(ctx, staff.email)).auth;
    await ctx.http().post(`/api/orders/${orderId}/items/${beerLine.id}/void`).set(staffAuth).send({ reason: 'Cliente desistiu' }).expect(403);
    await ctx.http().post(`/api/orders/${orderId}/items/${beerLine.id}/void`).set(auth).send({ reason: 'x' }).expect(400);

    const voided = await ctx.http().post(`/api/orders/${orderId}/items/${beerLine.id}/void`).set(auth).send({ reason: 'Cliente desistiu' }).expect(200);
    expect(voided.body.total).toBe('12');
    await ctx.http().post(`/api/orders/${orderId}/items/${beerLine.id}/void`).set(auth).send({ reason: 'outra vez' }).expect(409);
    const voidTicket = await ctx.http().get(`/api/orders/${orderId}/items/${beerLine.id}/void-ticket`).set(auth).responseType('blob').expect(200);
    expect(isTicket(voidTicket.body)).toBe(true);

    const unsent = await add(orderId, dish, 1);
    const fresh = unsent.body.items.at(-1);
    await ctx.http().delete(`/api/orders/${orderId}/items/${fresh.id}`).set(auth).expect(200);

    const prebill = await ctx.http().get(`/api/orders/${orderId}/prebill`).set(auth).responseType('blob').expect(200);
    expect(isTicket(prebill.body)).toBe(true);
    expect(pages(prebill.body)).toBe(1);

    await ctx.http().post(`/api/orders/${orderId}/close`).set(auth).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 12 }] }).expect(200);
    const invoice = await ctx.prisma.invoice.findFirstOrThrow({ where: { hotelId: hotel.id }, include: { lines: true } });
    expect(invoice.lines.map((line) => line.description)).toEqual([expect.stringContaining('Bitoque')]);
    expect(Number((await ctx.prisma.stockLevel.findFirstOrThrow({ where: { warehouseId: warehouse.id, productId: beer.id } })).quantity)).toBe(10);

    const ticket = await ctx.http().get(`/api/invoices/${invoice.id}/pdf?format=ticket`).set(auth).responseType('blob').expect(200);
    expect(isTicket(ticket.body)).toBe(true);
    expect(pages(ticket.body)).toBe(1);
  });

  it('a conta do quarto mostra o consumo lancado e pode ser paga com comprovativo', async () => {
    const { hotel, rooms, dish, orderId } = await setup();
    const guest = await createGuest(ctx.prisma, hotel.id);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(0), checkOut: day(1) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    await add(orderId, dish, 2);
    await ctx.http().post(`/api/orders/${orderId}/close`).set(auth).send({ mode: 'ROOM', reservationId: reservation.body.id }).expect(200);

    const statement = await ctx.http().get(`/api/reservations/${reservation.body.id}/statement`).set(auth).responseType('blob').expect(200);
    expect(isTicket(statement.body)).toBe(true);

    const folio = await ctx.http().get(`/api/reservations/${reservation.body.id}/folio`).set(auth).expect(200);
    const restaurant = folio.body.charges.filter((charge: { type: string }) => charge.type === 'RESTAURANT');
    expect(restaurant).toHaveLength(1);
    await ctx.http()
      .post(`/api/reservations/${reservation.body.id}/invoices`)
      .set(auth)
      .send({ type: 'INVOICE_RECEIPT', chargeIds: restaurant.map((charge: { id: number }) => charge.id) })
      .expect(201);
    const payment = await ctx.http().post(`/api/reservations/${reservation.body.id}/payments`).set(auth).send({ amount: 24, method: 'CARD' }).expect(201);
    const slip = await ctx.http().get(`/api/payments/${payment.body.id}/slip`).set(auth).responseType('blob').expect(200);
    expect(isTicket(slip.body)).toBe(true);

    const after = await ctx.http().get(`/api/reservations/${reservation.body.id}/folio`).set(auth).expect(200);
    expect(after.body.balance).toBe('80');

    const other = await createHotel(ctx.prisma);
    const outsider = await createUser(ctx.prisma, UserRole.MANAGER, other.hotel.id);
    const outsiderAuth = (await login(ctx, outsider.email)).auth;
    await ctx.http().get(`/api/payments/${payment.body.id}/slip`).set(outsiderAuth).expect(404);
    await ctx.http().get(`/api/reservations/${reservation.body.id}/statement`).set(outsiderAuth).expect(404);
  });
});

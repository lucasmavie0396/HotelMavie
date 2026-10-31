import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Perfil Caixa', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('so vende no restaurante/bar e gere o seu caixa', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const cashier = (await login(ctx, (await createUser(ctx.prisma, UserRole.CASHIER, hotel.id, { cash: false })).email)).auth;
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 16 } });
    const drinks = await ctx.prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Bebidas', prepStation: 'BAR' } });
    const beer = await ctx.prisma.product.create({ data: { hotelId: hotel.id, categoryId: drinks.id, name: 'Cerveja', price: 2.5, taxRateId: rate.id } });

    const guest = await createGuest(ctx.prisma, hotel.id);
    const stay = await ctx.http().post('/api/reservations').set(manager).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(0), checkOut: day(2) }).expect(201);
    await ctx.http().post(`/api/reservations/${stay.body.id}/check-in`).set(manager).expect(200);
    await ctx.http().post('/api/reservations').set(manager).send({ guestId: guest.id, roomId: rooms[1].id, checkIn: day(5), checkOut: day(6) }).expect(201);

    for (const path of ['/api/rooms', '/api/guests', '/api/invoices', '/api/reports/catalog', '/api/dashboard', '/api/printers', '/api/kds']) {
      await ctx.http().get(path).query({ hotelId: hotel.id, station: 'BAR' }).set(cashier).expect(403);
    }
    await ctx.http().post(`/api/reservations/${stay.body.id}/payments`).set(cashier).send({ amount: 5, method: 'CARD' }).expect(403);
    await ctx.http().post(`/api/reservations/${stay.body.id}/invoices`).set(cashier).send({}).expect(403);

    await ctx.http().get('/api/auth/me').set(cashier).expect(200);
    await ctx.http().get('/api/hotels').set(cashier).expect(200);
    await ctx.http().get('/api/products').query({ hotelId: hotel.id }).set(cashier).expect(200);
    await ctx.http().get('/api/dining-tables').query({ hotelId: hotel.id }).set(cashier).expect(200);
    await ctx.http().get('/api/payment-types').query({ hotelId: hotel.id }).set(cashier).expect(200);
    const inHouse = await ctx.http().get('/api/reservations').query({ hotelId: hotel.id }).set(cashier).expect(200);
    expect(inHouse.body.map((reservation: { id: number }) => reservation.id)).toEqual([stay.body.id]);

    const register = await ctx.prisma.cashRegister.create({ data: { hotelId: hotel.id, name: 'Bar' } });
    await ctx.http().get('/api/cash-registers').query({ hotelId: hotel.id }).set(cashier).expect(200);
    await ctx.http().post('/api/cash-registers').set(cashier).send({ hotelId: hotel.id, name: 'Nova' }).expect(403);
    const session = await ctx.http().post(`/api/cash-registers/${register.id}/open`).set(cashier).send({ openingAmount: 20 }).expect(201);

    const order = await ctx.http().post('/api/orders').set(cashier).send({ hotelId: hotel.id, outlet: 'BAR' }).expect(201);
    const added = await ctx.http().post(`/api/orders/${order.body.id}/items`).set(cashier).send({ productId: beer.id, quantity: 2 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/send`).set(cashier).expect(200);
    await ctx.http().get('/api/kds/printing').query({ hotelId: hotel.id }).set(cashier).expect(200);
    await ctx.http().post(`/api/orders/${order.body.id}/items/${added.body.items[0].id}/void`).set(cashier).send({ reason: 'engano' }).expect(403);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(cashier).send({ mode: 'PAY', payments: [{ method: 'CASH', amount: 5 }] }).expect(200);
    const invoice = await ctx.prisma.invoice.findFirstOrThrow({ where: { hotelId: hotel.id } });

    await ctx.http().post('/api/print').set(cashier).send({ document: 'INVOICE', invoiceId: invoice.id }).expect(200);
    await ctx.http().post('/api/print').set(cashier).send({ document: 'STATEMENT', reservationId: stay.body.id }).expect(403);
    await ctx.http().get('/api/print/pdf').query({ document: 'REPORT', report: 'sales', hotelId: hotel.id, from: day(0), to: day(0) }).set(cashier).expect(403);

    await ctx.http().post(`/api/cash-sessions/${session.body.id}/close`).set(cashier).send({ countedAmount: 25 }).expect(200);
    const pdf = await ctx.http().get('/api/print/pdf').query({ document: 'REPORT', report: 'cash-close', sessionId: session.body.id, paper: 'MM80' }).set(cashier).buffer(true).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});

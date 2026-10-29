import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Painel', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('devolve previsao de ocupacao, receita por dia, origens e indicadores; a rececao nao ve valores', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma, { rooms: 3 });
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const reception = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email)).auth;
    const guest = await createGuest(ctx.prisma, hotel.id);

    const stay = await ctx.http().post('/api/reservations').set(manager).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(0), checkOut: day(2) }).expect(201);
    await ctx.http().post(`/api/reservations/${stay.body.id}/check-in`).set(manager).expect(200);
    await ctx.http().post('/api/reservations').set(manager).send({ guestId: guest.id, roomId: rooms[1].id, checkIn: day(1), checkOut: day(3), source: 'PHONE' }).expect(201);
    await ctx.prisma.reservation.create({
      data: {
        code: `RD${Date.now()}`,
        hotelId: hotel.id,
        guestId: guest.id,
        roomId: rooms[2].id,
        checkIn: new Date(`${day(5)}T00:00:00Z`),
        checkOut: new Date(`${day(6)}T00:00:00Z`),
        pricePerNight: 150,
        totalAmount: 150,
        source: 'ONLINE',
        depositAmount: 90,
        depositReference: 'MP-1',
      },
    });

    const { body } = await ctx.http().get(`/api/dashboard?hotelId=${hotel.id}`).set(manager).expect(200);
    expect(body.forecast).toHaveLength(14);
    expect(body.forecast[0]).toMatchObject({ date: day(0), confirmed: 1, pending: 0, occupancy: 33 });
    expect(body.forecast[1]).toMatchObject({ confirmed: 1, pending: 1, arrivals: 1 });
    expect(body.forecast[2]).toMatchObject({ departures: 1 });
    expect(body.forecast[5]).toMatchObject({ pending: 1, arrivals: 1 });
    expect(body.kpis).toMatchObject({ pendingRequests: 2, pendingDeposits: 1, openOrders: 0 });
    expect(Number(body.kpis.revenueToday)).toBe(160);
    expect(body.revenue).toHaveLength(14);
    expect(body.revenue[13]).toMatchObject({ date: day(0), accommodation: '160' });
    expect(body.sources.map((row: { source: string; count: number }) => [row.source, row.count]).sort()).toEqual([
      ['DESK', 1],
      ['ONLINE', 1],
      ['PHONE', 1],
    ]);

    const asReception = await ctx.http().get(`/api/dashboard?hotelId=${hotel.id}`).set(reception).expect(200);
    expect(asReception.body.revenue).toBeNull();
    expect(asReception.body.kpis.revenueToday).toBeNull();
    expect(asReception.body.forecast).toHaveLength(14);
  });
});

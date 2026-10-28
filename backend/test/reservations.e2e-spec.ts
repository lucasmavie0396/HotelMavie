import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Reservas', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  const book = (body: object) => ctx.http().post('/api/reservations').set(auth).send(body);

  it('impede sobreposicoes mas aceita entrada no dia de saida', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const guest = await createGuest(ctx.prisma, hotel.id);
    const base = { guestId: guest.id, roomId: rooms[0].id };

    const first = await book({ ...base, checkIn: day(10), checkOut: day(13) }).expect(201);
    expect(first.body.totalAmount).toBe('240');

    await book({ ...base, checkIn: day(12), checkOut: day(14) }).expect(409);
    await book({ ...base, checkIn: day(9), checkOut: day(11) }).expect(409);
    await book({ ...base, checkIn: day(9), checkOut: day(14) }).expect(409);
    await book({ ...base, checkIn: day(13), checkOut: day(15) }).expect(201);
    await book({ ...base, checkIn: day(8), checkOut: day(10) }).expect(201);
  });

  it('com pedidos em simultaneo para o mesmo quarto so um e aceite', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const guest = await createGuest(ctx.prisma, hotel.id);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => book({ guestId: guest.id, roomId: rooms[1].id, checkIn: day(20), checkOut: day(22) })),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(5);
  });

  it('cancelar liberta o quarto', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const guest = await createGuest(ctx.prisma, hotel.id);
    const body = { guestId: guest.id, roomId: rooms[0].id, checkIn: day(5), checkOut: day(6) };
    const reservation = await book(body).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/cancel`).set(auth).expect(200);
    await book(body).expect(201);
  });

  it('valida capacidade, datas no passado e estadias vazias', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const guest = await createGuest(ctx.prisma, hotel.id);
    await book({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(1), checkOut: day(2), adults: 3 }).expect(400);
    await book({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(-2), checkOut: day(1) }).expect(400);
    await book({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(3), checkOut: day(3) }).expect(400);
  });

  it('fluxo de check-in e check-out muda o estado do quarto', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const guest = await createGuest(ctx.prisma, hotel.id);
    const future = await book({ guestId: guest.id, roomId: rooms[1].id, checkIn: day(3), checkOut: day(4) }).expect(201);
    await ctx.http().post(`/api/reservations/${future.body.id}/check-in`).set(auth).expect(409);

    const today = await book({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(0), checkOut: day(2) }).expect(201);
    const id = today.body.id;
    await ctx.http().post(`/api/reservations/${id}/check-in`).set(auth).expect(200);
    expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: rooms[0].id } })).status).toBe('OCCUPIED');
    await ctx.http().post(`/api/reservations/${id}/cancel`).set(auth).expect(409);

    await ctx.http().post(`/api/reservations/${id}/payments`).set(auth).send({ amount: 160, method: 'CARD' }).expect(201);
    await ctx.http().post(`/api/reservations/${id}/check-out`).set(auth).expect(200);
    expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: rooms[0].id } })).status).toBe('CLEANING');
  });

  it('um hotel nao ve nem altera dados de outro', async () => {
    const a = await createHotel(ctx.prisma);
    const b = await createHotel(ctx.prisma);
    const guestA = await createGuest(ctx.prisma, a.hotel.id);
    const reservationA = await book({ guestId: guestA.id, roomId: a.rooms[0].id, checkIn: day(30), checkOut: day(31) }).expect(201);

    const staffB = await createUser(ctx.prisma, UserRole.MANAGER, b.hotel.id);
    const authB = (await login(ctx, staffB.email)).auth;

    await ctx.http().get(`/api/reservations/${reservationA.body.id}`).set(authB).expect(404);
    await ctx.http().post(`/api/reservations/${reservationA.body.id}/cancel`).set(authB).expect(404);
    await ctx.http().get(`/api/reservations?hotelId=${a.hotel.id}`).set(authB).expect(403);
    const own = await ctx.http().get('/api/reservations').set(authB).expect(200);
    expect(own.body.every((r: { hotelId: number }) => r.hotelId === b.hotel.id)).toBe(true);
    await ctx.http().get(`/api/guests/${guestA.id}`).set(authB).expect(404);
    await ctx.http().post('/api/reservations').set(authB).send({ guestId: guestA.id, roomId: a.rooms[1].id, checkIn: day(30), checkOut: day(31) }).expect(404);
  });

  it('reserva online cria pedido pendente e respeita disponibilidade', async () => {
    const { hotel } = await createHotel(ctx.prisma, { rooms: 3 });
    const slug = hotel.publicSlug;
    const availability = await ctx.http().get(`/api/public/hotels/${slug}/availability?checkIn=${day(40)}&checkOut=${day(42)}&guests=3`).expect(200);
    expect(availability.body).toHaveLength(1);
    expect(availability.body[0]).toMatchObject({ type: 'Suite', available: 1, total: '300.00' });

    const payload = { checkIn: day(40), checkOut: day(42), roomType: 'Suite', adults: 3, firstName: 'Rita', lastName: 'Online', email: 'rita@teste.local' };
    const first = await ctx.http().post(`/api/public/hotels/${slug}/reservations`).send(payload).expect(201);
    expect(first.body).toMatchObject({ status: 'PENDING', totalAmount: '300' });
    await ctx.http().post(`/api/public/hotels/${slug}/reservations`).send(payload).expect(409);

    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { publicEnabled: false } });
    await ctx.http().get(`/api/public/hotels/${slug}`).expect(404);
  });
});

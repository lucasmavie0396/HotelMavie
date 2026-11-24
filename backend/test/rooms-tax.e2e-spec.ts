import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Quartos: editar dados, preco e IVA por quarto', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function checkIn(hotelId: number, roomId: number) {
    const guest = await createGuest(ctx.prisma, hotelId);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId, checkIn: day(0), checkOut: day(2) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    const folio = await ctx.http().get(`/api/reservations/${reservation.body.id}/folio`).set(auth).expect(200);
    return { reservation: reservation.body, charge: folio.body.charges.find((charge: { type: string }) => charge.type === 'ACCOMMODATION') };
  }

  it('o gestor edita numero, tipo, capacidade, preco e IVA; o alojamento usa o IVA do quarto ou o do hotel', async () => {
    const { hotel, rooms, accommodationRate } = await createHotel(ctx.prisma, { accommodationRate: 16 });
    const reduced = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Reduzida', rate: 5, atCategory: 'RED' } });
    const other = await createHotel(ctx.prisma);

    const edited = await ctx.http()
      .patch(`/api/rooms/${rooms[0].id}`)
      .set(auth)
      .send({ number: '201', type: 'Deluxe', capacity: 3, floor: 2, pricePerNight: 95.5, taxRateId: reduced.id })
      .expect(200);
    expect(edited.body).toMatchObject({ number: '201', type: 'Deluxe', capacity: 3, floor: 2, pricePerNight: '95.5', taxRateId: reduced.id, taxRate: { rate: '5' } });
    await ctx.http().patch(`/api/rooms/${rooms[0].id}`).set(auth).send({ taxRateId: other.accommodationRate!.id }).expect(400);
    await ctx.http().patch(`/api/rooms/${rooms[0].id}`).set(auth).send({ number: rooms[1].number }).expect(409);

    const list = await ctx.http().get('/api/rooms').query({ hotelId: hotel.id }).set(auth).expect(200);
    expect(list.body.find((room: { id: number }) => room.id === rooms[0].id).taxRate.name).toBe('Reduzida');

    const withRoomRate = await checkIn(hotel.id, rooms[0].id);
    expect(withRoomRate.reservation.pricePerNight).toBe('95.5');
    expect(withRoomRate.charge).toMatchObject({ taxRateId: reduced.id, unitPrice: '95.5' });
    const withHotelRate = await checkIn(hotel.id, rooms[1].id);
    expect(withHotelRate.charge.taxRateId).toBe(accommodationRate!.id);

    const cleared = await ctx.http().patch(`/api/rooms/${rooms[0].id}`).set(auth).send({ taxRateId: null }).expect(200);
    expect(cleared.body).toMatchObject({ taxRateId: null, taxRate: null });
  });

  it('a rececao muda o estado do quarto mas nao o preco nem o IVA', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const reception = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const receptionAuth = (await login(ctx, reception.email)).auth;
    await ctx.http().patch(`/api/rooms/${rooms[0].id}`).set(receptionAuth).send({ pricePerNight: 10 }).expect(403);
    await ctx.http().patch(`/api/rooms/${rooms[0].id}`).set(receptionAuth).send({ status: 'CLEANING' }).expect(200);
    expect(Number((await ctx.prisma.room.findUniqueOrThrow({ where: { id: rooms[0].id } })).pricePerNight)).toBe(80);
  });
});

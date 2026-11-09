import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext, uid } from './helpers';

describe('Perfis de acesso', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  async function setup() {
    const { hotel, rooms } = await createHotel(ctx.prisma, { rooms: 2 });
    const admin = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
    const staff = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    return { hotel, rooms, admin, staff, auth: (await login(ctx, staff.email)).auth };
  }

  const room = (hotelId: number) => ({ hotelId, number: uid(), type: 'Teste', capacity: 2, pricePerNight: 50 });

  it('o perfil decide o acesso por area, no servidor', async () => {
    const { hotel, rooms, admin, staff, auth } = await setup();
    await ctx.http().post('/api/rooms').set(auth).send(room(hotel.id)).expect(403);
    expect((await ctx.http().get('/api/invoices').query({ hotelId: hotel.id }).set(auth).expect(200)).body).toEqual([]);

    const created = await ctx.http().post('/api/access-profiles').set(admin).send({ hotelId: hotel.id, name: 'Governanta', baseRole: 'RECEPTION', permissions: { rooms: 'MANAGE', guests: 'VIEW', pos: 'VIEW' } }).expect(201);
    expect(created.body.permissions).toMatchObject({ rooms: 'MANAGE', guests: 'VIEW', invoices: 'NONE' });
    await ctx.http().patch(`/api/users/${staff.user.id}`).set(admin).send({ profileId: created.body.id }).expect(200);

    await ctx.http().get('/api/rooms').query({ hotelId: hotel.id }).set(auth).expect(200);
    await ctx.http().post('/api/rooms').set(auth).send(room(hotel.id)).expect(201);
    await ctx.http().get('/api/guests').query({ hotelId: hotel.id }).set(auth).expect(200);
    await ctx.http().post('/api/guests').set(auth).send({ hotelId: hotel.id, firstName: 'A', lastName: 'B' }).expect(403);
    await ctx.http().get('/api/invoices').query({ hotelId: hotel.id }).set(auth).expect(403);
    const guest = await createGuest(ctx.prisma, hotel.id);
    await ctx.http().post('/api/reservations').set(admin).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(1), checkOut: day(2) }).expect(201);
    expect((await ctx.http().get('/api/reservations').query({ hotelId: hotel.id }).set(admin).expect(200)).body).toHaveLength(1);
    expect((await ctx.http().get('/api/reservations').query({ hotelId: hotel.id }).set(auth).expect(200)).body).toEqual([]);
    await ctx.http().get('/api/products').query({ hotelId: hotel.id }).set(auth).expect(200);
    await ctx.http().post('/api/products').set(auth).send({ hotelId: hotel.id, name: 'X', price: 1 }).expect(403);
    await ctx.http().get('/api/users').set(auth).expect(403);
    await ctx.http().get('/api/access-profiles').set(auth).expect(403);

    const me = await ctx.http().get('/api/auth/me').set(auth).expect(200);
    expect(me.body.permissions).toMatchObject({ rooms: 'MANAGE', invoices: 'NONE' });
    expect(me.body.profile.name).toBe('Governanta');

    await ctx.http().patch(`/api/access-profiles/${created.body.id}`).set(admin).send({ permissions: { guests: 'MANAGE' } }).expect(200);
    await ctx.http().get('/api/rooms').query({ hotelId: hotel.id }).set(auth).expect(403);
    await ctx.http().post('/api/guests').set(auth).send({ hotelId: hotel.id, firstName: 'A', lastName: 'B' }).expect(201);
  });

  it('valida perfis, atribuicoes e remocao', async () => {
    const { hotel, admin, staff } = await setup();
    const other = await createHotel(ctx.prisma);
    await ctx.http().post('/api/access-profiles').set(admin).send({ hotelId: hotel.id, name: 'Chefe', baseRole: 'ADMIN' }).expect(400);
    await ctx.http().post('/api/access-profiles').set(admin).send({ hotelId: hotel.id, name: 'Errado', baseRole: 'CASHIER', permissions: { naoexiste: 'VIEW' } }).expect(400);

    const profile = await ctx.http().post('/api/access-profiles').set(admin).send({ hotelId: hotel.id, name: 'Bar', baseRole: 'CASHIER' }).expect(201);
    expect(profile.body.permissions).toMatchObject({ pos: 'MANAGE', cash: 'MANAGE', rooms: 'NONE' });
    await ctx.http().post('/api/access-profiles').set(admin).send({ hotelId: hotel.id, name: 'Bar', baseRole: 'CASHIER' }).expect(409);

    const stranger = await createUser(ctx.prisma, UserRole.RECEPTION, other.hotel.id);
    await ctx.http().patch(`/api/users/${stranger.user.id}`).set(admin).send({ profileId: profile.body.id }).expect(400);

    const updated = await ctx.http().patch(`/api/users/${staff.user.id}`).set(admin).send({ profileId: profile.body.id }).expect(200);
    expect(updated.body.role).toBe('CASHIER');
    await ctx.http().delete(`/api/access-profiles/${profile.body.id}`).set(admin).expect(409);

    const list = await ctx.http().get('/api/access-profiles').query({ hotelId: hotel.id }).set(admin).expect(200);
    expect(list.body[0]).toMatchObject({ name: 'Bar', users: 1 });

    await ctx.http().patch(`/api/users/${staff.user.id}`).set(admin).send({ profileId: null }).expect(200);
    await ctx.http().delete(`/api/access-profiles/${profile.body.id}`).set(admin).expect(204);
  });
});

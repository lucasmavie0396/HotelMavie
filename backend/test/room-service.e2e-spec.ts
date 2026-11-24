import { UserRole } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { localParts } from '../src/at/at-format';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Pedidos do quarto por tablet', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  const address = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  const tablet = (token: string) => ({ 'X-Room-Device': token, 'X-Forwarded-For': address() });

  async function setup() {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 16 } });
    const bar = await ctx.prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Bebidas', outlet: 'BAR', prepStation: 'BAR' } });
    const kitchen = await ctx.prisma.productCategory.create({ data: { hotelId: hotel.id, name: 'Pratos', outlet: 'RESTAURANT', prepStation: 'KITCHEN' } });
    const beer = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Cerveja', price: 2.5, taxRateId: rate.id, categoryId: bar.id } });
    const dish = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Prato do dia', price: 10, taxRateId: rate.id, categoryId: kitchen.id } });
    const hidden = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Garrafa reserva', price: 90, taxRateId: rate.id, categoryId: bar.id, roomService: false } });
    return { hotel, rooms, beer, dish, hidden };
  }

  async function pairedTablet(hotelId: number, roomId: number) {
    const device = await ctx.http().post('/api/room-devices').set(auth).send({ hotelId, roomId, name: 'Tablet' }).expect(201);
    const paired = await ctx.http().post('/api/room-device/pair').set('X-Forwarded-For', address()).send({ code: device.body.pairingCode }).expect(200);
    return { device: device.body, token: paired.body.token as string };
  }

  async function checkIn(hotelId: number, roomId: number) {
    const guest = await createGuest(ctx.prisma, hotelId);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId, checkIn: day(0), checkOut: day(2) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    return { guest, reservation: reservation.body };
  }

  it('tablet associado ao quarto pede, a equipa aceita, entrega e o valor vai para a conta do quarto', async () => {
    const { hotel, rooms, beer, dish, hidden } = await setup();
    const device = await ctx.http().post('/api/room-devices').set(auth).send({ hotelId: hotel.id, roomId: rooms[0].id }).expect(201);
    expect(device.body).toMatchObject({ paired: false, room: { number: rooms[0].number } });
    expect(device.body.pairingCode).toMatch(/^\d{6}$/);
    expect(device.body).not.toHaveProperty('tokenHash');

    const wrong = device.body.pairingCode === '000000' ? '111111' : '000000';
    await ctx.http().post('/api/room-device/pair').set('X-Forwarded-For', address()).send({ code: wrong }).expect(400);
    const paired = await ctx.http().post('/api/room-device/pair').set('X-Forwarded-For', address()).send({ code: device.body.pairingCode }).expect(200);
    expect(paired.body.room).toBe(rooms[0].number);
    const token = paired.body.token as string;
    await ctx.http().post('/api/room-device/pair').set('X-Forwarded-For', address()).send({ code: device.body.pairingCode }).expect(400);

    await ctx.http().get('/api/room-device/session').set('X-Forwarded-For', address()).expect(401);
    const empty = await ctx.http().get('/api/room-device/session').set(tablet(token)).expect(200);
    expect(empty.body).toMatchObject({ available: false, reason: 'NO_GUEST', room: { number: rooms[0].number }, guest: null });
    await ctx.http().post('/api/room-device/orders').set(tablet(token)).send({ outlet: 'BAR', items: [{ productId: beer.id, quantity: 1 }] }).expect(409);

    const { guest, reservation } = await checkIn(hotel.id, rooms[0].id);
    const session = await ctx.http().get('/api/room-device/session').set(tablet(token)).expect(200);
    expect(session.body).toMatchObject({ available: true, reason: null, guest: { firstName: guest.firstName } });

    const menu = await ctx.http().get('/api/room-device/menu').set(tablet(token)).expect(200);
    const names = menu.body.map((product: { name: string }) => product.name);
    expect(names).toEqual(expect.arrayContaining(['Cerveja', 'Prato do dia']));
    expect(names).not.toContain('Garrafa reserva');

    await ctx.http().post('/api/room-device/orders').set(tablet(token)).send({ outlet: 'BAR', items: [{ productId: dish.id, quantity: 1 }] }).expect(400);
    await ctx.http().post('/api/room-device/orders').set(tablet(token)).send({ outlet: 'BAR', items: [{ productId: hidden.id, quantity: 1 }] }).expect(400);
    const placed = await ctx.http()
      .post('/api/room-device/orders')
      .set(tablet(token))
      .send({ outlet: 'BAR', items: [{ productId: beer.id, quantity: 2, notes: 'Sem copo' }] })
      .expect(201);
    expect(placed.body).toMatchObject({ roomServiceStatus: 'PENDING', tableLabel: `Quarto ${rooms[0].number}`, total: '5', reservationId: reservation.id });

    const queue = await ctx.http().get('/api/room-orders').query({ hotelId: hotel.id }).set(auth).expect(200);
    expect(queue.body.map((order: { id: number }) => order.id)).toContain(placed.body.id);

    const accepted = await ctx.http().post(`/api/room-orders/${placed.body.id}/accept`).set(auth).expect(200);
    expect(accepted.body.order.roomServiceStatus).toBe('ACCEPTED');
    expect(accepted.body.stations).toEqual(['BAR']);
    expect(accepted.body.order.items.every((item: { sentAt: string | null }) => item.sentAt)).toBe(true);
    await ctx.http().post(`/api/room-orders/${placed.body.id}/accept`).set(auth).expect(409);

    const kds = await ctx.http().get('/api/kds').query({ hotelId: hotel.id, station: 'BAR' }).set(auth).expect(200);
    expect(kds.body.pending.some((card: { table: string }) => card.table === `Quarto ${rooms[0].number}`)).toBe(true);

    await ctx.http().post(`/api/room-orders/${placed.body.id}/dispatch`).set(auth).expect(200);
    const delivered = await ctx.http().post(`/api/room-orders/${placed.body.id}/deliver`).set(auth).expect(200);
    expect(delivered.body).toMatchObject({ roomServiceStatus: 'DELIVERED', status: 'CLOSED' });

    const folio = await ctx.http().get(`/api/reservations/${reservation.id}/folio`).set(auth).expect(200);
    expect(folio.body.charges.find((charge: { type: string }) => charge.type === 'BAR').total).toBe('5');
    const history = await ctx.http().get('/api/room-device/orders').set(tablet(token)).expect(200);
    expect(history.body[0]).toMatchObject({ id: placed.body.id, roomServiceStatus: 'DELIVERED' });
    const after = await ctx.http().get('/api/room-device/session').set(tablet(token)).expect(200);
    expect(after.body.spent).toBe('5');

    const report = await ctx.http().get('/api/reports/view/room-service').query({ hotelId: hotel.id, from: day(-1), to: day(1) }).set(auth).expect(200);
    const origins = report.body.sections.find((section: { title: string }) => section.title === 'Por origem');
    expect(origins.table.rows.find((row: string[]) => row[0] === 'Quartos (tablet)')[1]).toBe('1');
  });

  it('limite, bloqueio, recusa, horario, aceitacao automatica e tablet desligado', async () => {
    const { hotel, rooms, beer } = await setup();
    const { device, token } = await pairedTablet(hotel.id, rooms[1].id);
    const { reservation } = await checkIn(hotel.id, rooms[1].id);
    const order = (quantity: number) => ctx.http().post('/api/room-device/orders').set(tablet(token)).send({ outlet: 'BAR', items: [{ productId: beer.id, quantity }] });

    await ctx.http().patch(`/api/reservations/${reservation.id}/room-service`).set(auth).send({ limit: 6 }).expect(200);
    const first = await order(2).expect(201);
    const over = await order(1).expect(409);
    expect(over.body.message).toContain('limite');

    await ctx.http().post(`/api/room-orders/${first.body.id}/reject`).set(auth).send({ reason: 'Bar fechado' }).expect(200);
    const history = await ctx.http().get('/api/room-device/orders').set(tablet(token)).expect(200);
    expect(history.body[0]).toMatchObject({ roomServiceStatus: 'REJECTED', rejectReason: 'Bar fechado', status: 'CANCELLED' });
    await order(1).expect(201);

    await ctx.http().patch(`/api/reservations/${reservation.id}/room-service`).set(auth).send({ blocked: true, limit: null }).expect(200);
    await order(1).expect(403);
    const blocked = await ctx.http().get('/api/room-device/session').set(tablet(token)).expect(200);
    expect(blocked.body).toMatchObject({ available: false, reason: 'BLOCKED' });
    await ctx.http().patch(`/api/reservations/${reservation.id}/room-service`).set(auth).send({ blocked: false }).expect(200);

    const hour = (Number(localParts(new Date()).dateTime.slice(11, 13)) + 12) % 24;
    const closed = `${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:01`;
    await ctx.http().patch('/api/room-devices/settings').set(auth).send({ hotelId: hotel.id, barHours: 'nada' }).expect(400);
    await ctx.http().patch('/api/room-devices/settings').set(auth).send({ hotelId: hotel.id, barHours: closed }).expect(200);
    await order(1).expect(409);
    const settings = await ctx.http().patch('/api/room-devices/settings').set(auth).send({ hotelId: hotel.id, barHours: '', autoAccept: true }).expect(200);
    expect(settings.body).toMatchObject({ autoAccept: true, barHours: null });
    const automatic = await order(1).expect(201);
    expect(automatic.body.roomServiceStatus).toBe('ACCEPTED');
    expect(automatic.body.items[0].sentAt).not.toBeNull();

    const reception = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const receptionAuth = (await login(ctx, reception.email)).auth;
    await ctx.http().post('/api/room-devices').set(receptionAuth).send({ hotelId: hotel.id, roomId: rooms[0].id }).expect(403);
    await ctx.http().patch(`/api/reservations/${reservation.id}/room-service`).set(receptionAuth).send({ limit: 50 }).expect(200);

    await ctx.http().patch(`/api/room-devices/${device.id}`).set(auth).send({ active: false }).expect(200);
    await ctx.http().get('/api/room-device/session').set(tablet(token)).expect(401);
  });

  it('a mesa passa so alguns artigos para a conta do quarto', async () => {
    const { hotel, rooms, beer, dish } = await setup();
    const { reservation } = await checkIn(hotel.id, rooms[2].id);
    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableLabel: 'Mesa 4' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: beer.id, quantity: 3 }).expect(201);
    const full = await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: dish.id, quantity: 1 }).expect(201);
    const beerLine = full.body.items.find((item: { productId: number }) => item.productId === beer.id);

    const moved = await ctx.http()
      .post(`/api/orders/${order.body.id}/charge-to-room`)
      .set(auth)
      .send({ reservationId: reservation.id, items: [{ itemId: beerLine.id, quantity: 2 }] })
      .expect(200);
    expect(moved.body.from).toMatchObject({ status: 'OPEN', total: '12.5' });
    expect(moved.body.charged).toMatchObject({ status: 'CLOSED', tableLabel: 'Mesa 4', reservationId: reservation.id });

    const folio = await ctx.http().get(`/api/reservations/${reservation.id}/folio`).set(auth).expect(200);
    const charge = folio.body.charges.find((item: { type: string }) => item.type === 'RESTAURANT');
    expect(charge).toMatchObject({ total: '5' });
    expect(charge.description).toContain('Mesa 4');
  });
});

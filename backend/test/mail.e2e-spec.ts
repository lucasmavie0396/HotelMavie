import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Emails', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function waitForLogs(relatedId: number, count: number) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const logs = await ctx.prisma.emailLog.findMany({ where: { relatedId }, orderBy: { id: 'asc' } });
      if (logs.length >= count) return logs;
      await new Promise((done) => setTimeout(done, 100));
    }
    return ctx.prisma.emailLog.findMany({ where: { relatedId } });
  }

  it('reserva online avisa o hospede e o hotel, e a confirmacao avisa o hospede', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { email: 'rececao@hotel.local' } });
    const booking = await ctx.http()
      .post(`/api/public/hotels/${hotel.publicSlug}/reservations`)
      .send({ checkIn: day(15), checkOut: day(17), roomType: 'Standard', adults: 2, firstName: 'Ines', lastName: 'Email', email: 'Ines@Teste.local' })
      .expect(201);
    const reservation = await ctx.prisma.reservation.findUniqueOrThrow({ where: { code: booking.body.code } });

    const logs = await waitForLogs(reservation.id, 2);
    expect(logs.map((log) => [log.kind, log.recipient, log.status]).sort()).toEqual([
      ['BOOKING_ALERT', 'rececao@hotel.local', 'LOGGED'],
      ['BOOKING_REQUEST', 'ines@teste.local', 'LOGGED'],
    ]);
    expect(logs[0].subject).toContain(booking.body.code);

    await ctx.http().post(`/api/reservations/${reservation.id}/confirm`).set(auth).expect(200);
    const after = await waitForLogs(reservation.id, 3);
    expect(after.find((log) => log.kind === 'BOOKING_CONFIRMED')).toMatchObject({ recipient: 'ines@teste.local' });
  });

  it('envia a fatura em PDF e exige destinatario', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const guest = await ctx.prisma.guest.update({ where: { id: (await createGuest(ctx.prisma, hotel.id)).id }, data: { email: null } });
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(0), checkOut: day(1) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    const invoice = await ctx.http().post(`/api/reservations/${reservation.body.id}/invoices`).set(auth).send({}).expect(201);

    await ctx.http().post(`/api/invoices/${invoice.body.id}/email`).set(auth).send({}).expect(400);
    await ctx.http().post(`/api/invoices/${invoice.body.id}/email`).set(auth).send({ to: 'nao-e-email' }).expect(400);
    const sent = await ctx.http().post(`/api/invoices/${invoice.body.id}/email`).set(auth).send({ to: 'cliente@teste.local' }).expect(200);
    expect(sent.body).toMatchObject({ kind: 'INVOICE', recipient: 'cliente@teste.local', status: 'LOGGED', relatedId: invoice.body.id });

    const list = await ctx.http().get(`/api/email-logs?hotelId=${hotel.id}`).set(auth).expect(200);
    expect(list.body.smtpConfigured).toBe(false);
    expect(list.body.items).toHaveLength(1);
  });
});

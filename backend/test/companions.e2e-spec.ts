import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, day, login, TestContext, uid } from './helpers';

describe('Dados completos e acompanhantes na reserva', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('reserva online guarda os dados do titular e dos acompanhantes', async () => {
    const { hotel } = await createHotel(ctx.prisma, { rooms: 3 });
    const slug = hotel.publicSlug;
    const email = `familia-${uid()}@teste.local`;
    const base = { checkIn: day(30), checkOut: day(33), roomType: 'Suite', adults: 2, children: 1, firstName: 'Joao', lastName: 'Machava', email };

    await ctx.http().post(`/api/public/hotels/${slug}/reservations`).send(base).expect(400);
    const tooMany = [1, 2, 3].map((index) => ({ firstName: `Pessoa${index}`, lastName: 'Machava' }));
    await ctx.http().post(`/api/public/hotels/${slug}/reservations`).send({ ...base, documentType: 'BI', documentNumber: '110100123456A', companions: tooMany }).expect(400);
    await ctx.http()
      .post(`/api/public/hotels/${slug}/reservations`)
      .send({ ...base, documentType: 'BI', documentNumber: '110100123456A', companions: [{ firstName: 'A', lastName: 'B', isChild: true }, { firstName: 'C', lastName: 'D', isChild: true }] })
      .expect(400);

    const booked = await ctx.http()
      .post(`/api/public/hotels/${slug}/reservations`)
      .send({
        ...base,
        birthDate: '1985-04-12',
        nationality: 'Mocambicana',
        documentType: 'BI',
        documentNumber: '110100123456A',
        taxId: '400111222',
        address: 'Av. 24 de Julho, Maputo',
        companions: [
          { firstName: 'Maria', lastName: 'Machava', nationality: 'Mocambicana', documentType: 'BI', documentNumber: '110100654321B', birthDate: '1987-09-01' },
          { firstName: 'Tiago', lastName: 'Machava', isChild: true, birthDate: '2018-02-20' },
        ],
      })
      .expect(201);

    const reservation = await ctx.prisma.reservation.findUniqueOrThrow({ where: { code: booked.body.code }, include: { guest: true, companions: { orderBy: { id: 'asc' } } } });
    expect(reservation.guest).toMatchObject({ nationality: 'Mocambicana', documentType: 'BI', documentNumber: '110100123456A', taxId: '400111222', address: 'Av. 24 de Julho, Maputo' });
    expect(reservation.guest.birthDate?.toISOString().slice(0, 10)).toBe('1985-04-12');
    expect(reservation.companions.map((companion) => [companion.firstName, companion.isChild, companion.documentNumber])).toEqual([
      ['Maria', false, '110100654321B'],
      ['Tiago', true, null],
    ]);

    await ctx.prisma.guest.update({ where: { id: reservation.guestId }, data: { phone: '+258 84 000 0000' } });
    await ctx.http()
      .post(`/api/public/hotels/${slug}/reservations`)
      .send({ ...base, checkIn: day(40), checkOut: day(41), children: 0, adults: 1, documentType: 'Passaporte', documentNumber: 'OUTRO123', phone: '+258 82 999 9999' })
      .expect(201);
    const after = await ctx.prisma.guest.findUniqueOrThrow({ where: { id: reservation.guestId } });
    expect(after).toMatchObject({ documentType: 'BI', documentNumber: '110100123456A', phone: '+258 84 000 0000' });
  });

  it('a rececao acrescenta, corrige e remove acompanhantes e o relatorio mostra-os', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma, { rooms: 3 });
    const reception = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email)).auth;
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const guest = await ctx.prisma.guest.create({ data: { hotelId: hotel.id, firstName: 'Titular', lastName: uid(), documentType: 'BI', documentNumber: 'T1' } });
    const created = await ctx.http().post('/api/reservations').set(reception).send({ guestId: guest.id, roomId: rooms[2].id, checkIn: day(0), checkOut: day(2), adults: 2, children: 1 }).expect(201);
    expect(created.body.companions).toEqual([]);

    const one = await ctx.http().post(`/api/reservations/${created.body.id}/companions`).set(reception).send({ firstName: 'Ana', lastName: 'Silva', documentType: 'BI', documentNumber: 'A1' }).expect(201);
    expect(one.body.companions).toHaveLength(1);
    const two = await ctx.http().post(`/api/reservations/${created.body.id}/companions`).set(reception).send({ firstName: 'Rui', lastName: 'Silva', isChild: true }).expect(201);
    await ctx.http().post(`/api/reservations/${created.body.id}/companions`).set(reception).send({ firstName: 'Extra', lastName: 'Pessoa' }).expect(400);
    await ctx.http().post(`/api/reservations/${created.body.id}/companions`).set(reception).send({ firstName: '', lastName: 'X' }).expect(400);

    const ruiId = two.body.companions[1].id;
    const fixed = await ctx.http().patch(`/api/reservations/${created.body.id}/companions/${ruiId}`).set(reception).send({ firstName: 'Rui', lastName: 'Silva', isChild: true, birthDate: '2019-06-01' }).expect(200);
    expect(fixed.body.companions[1].birthDate.slice(0, 10)).toBe('2019-06-01');

    await ctx.http().post(`/api/reservations/${created.body.id}/check-in`).set(reception).expect(200);
    const report = await ctx.http().get('/api/reports/view/guests').query({ hotelId: hotel.id, date: day(0) }).set(manager).expect(200);
    const names = report.body.sections[1].table.rows.map((row: string[]) => row[1]);
    expect(names).toEqual([`Titular ${guest.lastName}`, '  + Ana Silva', '  + Rui Silva (crianca)']);
    expect(report.body.sections[1].note).toBeUndefined();

    const removed = await ctx.http().delete(`/api/reservations/${created.body.id}/companions/${one.body.companions[0].id}`).set(reception).expect(200);
    expect(removed.body.companions.map((companion: { firstName: string }) => companion.firstName)).toEqual(['Rui']);
    const again = await ctx.http().get('/api/reports/view/guests').query({ hotelId: hotel.id, date: day(0) }).set(manager).expect(200);
    expect(again.body.sections[1].note).toContain('1 acompanhante');

    const other = await createHotel(ctx.prisma);
    const outsider = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, other.hotel.id)).email)).auth;
    await ctx.http().post(`/api/reservations/${created.body.id}/companions`).set(outsider).send({ firstName: 'X', lastName: 'Y' }).expect(404);
  });
});

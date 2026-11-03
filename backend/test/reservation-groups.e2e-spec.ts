import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, day, login, TestContext, uid } from './helpers';

describe('Reservas de varios quartos e empresariais', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createApp();
  });

  afterEach(() => ctx.app.close());

  it('site publico reserva varios quartos para uma familia num so pedido', async () => {
    const { hotel } = await createHotel(ctx.prisma, { rooms: 3, depositPercent: 50 });
    const email = `familia-${uid()}@teste.local`;
    const base = { checkIn: day(20), checkOut: day(22), firstName: 'Ana', lastName: 'Cossa', email, documentType: 'BI', documentNumber: `BI${uid()}`, depositReference: 'TRF-1' };

    await ctx.http()
      .post(`/api/public/hotels/${hotel.publicSlug}/reservations`)
      .send({ ...base, rooms: [{ roomType: 'Standard', adults: 3 }] })
      .expect(409);

    const booked = await ctx.http()
      .post(`/api/public/hotels/${hotel.publicSlug}/reservations`)
      .send({
        ...base,
        rooms: [
          { roomType: 'Standard', adults: 2, companions: [{ firstName: 'Rui', lastName: 'Cossa' }] },
          { roomType: 'Standard', adults: 1, children: 1, occupant: { firstName: 'Lia', lastName: 'Cossa', documentType: 'BI', documentNumber: `BI${uid()}` } },
        ],
      })
      .expect(201);
    expect(booked.body.code).toMatch(/^G/);
    expect(booked.body.rooms).toHaveLength(2);
    expect(Number(booked.body.totalAmount)).toBe(320);
    expect(Number(booked.body.depositAmount)).toBe(160);

    const group = await ctx.prisma.reservationGroup.findUniqueOrThrow({ where: { code: booked.body.code }, include: { reservations: { include: { guest: true, room: true } } } });
    expect(group.kind).toBe('INDIVIDUAL');
    expect(new Set(group.reservations.map((reservation) => reservation.roomId)).size).toBe(2);
    expect(group.reservations.map((reservation) => reservation.guest.firstName).sort()).toEqual(['Ana', 'Lia']);

    await ctx.http()
      .post(`/api/public/hotels/${hotel.publicSlug}/reservations`)
      .send({ ...base, rooms: [{ roomType: 'Standard', adults: 1 }, { roomType: 'Suite', adults: 2 }] })
      .expect(409);
    expect(await ctx.prisma.reservation.count({ where: { hotelId: hotel.id, roomId: (await ctx.prisma.room.findFirstOrThrow({ where: { hotelId: hotel.id, type: 'Suite' } })).id } })).toBe(0);
  });

  it('empresa reserva pelo site com os dados dos funcionarios e a rececao confirma o grupo', async () => {
    const { hotel } = await createHotel(ctx.prisma, { rooms: 3 });
    const reception = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email)).auth;
    const email = `rh-${uid()}@empresa.local`;
    const company = { name: 'Construtora Lda', taxId: '400555666', address: 'Av. Marginal, Maputo' };
    const base = { kind: 'CORPORATE', company, checkIn: day(5), checkOut: day(8), firstName: 'Paula', lastName: 'RH', email };

    await ctx.http()
      .post(`/api/public/hotels/${hotel.publicSlug}/reservations`)
      .send({ ...base, rooms: [{ roomType: 'Standard', adults: 1 }] })
      .expect(400);
    await ctx.http()
      .post(`/api/public/hotels/${hotel.publicSlug}/reservations`)
      .send({ ...base, company: undefined, rooms: [{ roomType: 'Standard', adults: 1, occupant: { firstName: 'X', lastName: 'Y', documentType: 'BI', documentNumber: 'X1' } }] })
      .expect(400);

    const booked = await ctx.http()
      .post(`/api/public/hotels/${hotel.publicSlug}/reservations`)
      .send({
        ...base,
        rooms: [
          { roomType: 'Standard', adults: 1, occupant: { firstName: 'Carlos', lastName: 'Mabote', documentType: 'BI', documentNumber: `C${uid()}` } },
          { roomType: 'Suite', adults: 2, occupant: { firstName: 'Joana', lastName: 'Sitoe', documentType: 'Passaporte', documentNumber: `J${uid()}` }, companions: [{ firstName: 'Tomas', lastName: 'Nhaca', documentType: 'BI', documentNumber: 'T1' }] },
        ],
      })
      .expect(201);
    expect(booked.body.companyName).toBe('Construtora Lda');

    const group = await ctx.prisma.reservationGroup.findUniqueOrThrow({ where: { code: booked.body.code } });
    expect(group).toMatchObject({ kind: 'CORPORATE', companyTaxId: '400555666', companyEmail: email, contactName: 'Paula RH' });
    expect(await ctx.prisma.guest.count({ where: { hotelId: hotel.id, email } })).toBe(0);

    const detail = await ctx.http().get(`/api/reservation-groups/${group.id}`).set(reception).expect(200);
    expect(detail.body.reservations.map((reservation: { guest: { firstName: string } }) => reservation.guest.firstName)).toEqual(['Carlos', 'Joana']);
    expect(detail.body.reservations[0].group.companyName).toBe('Construtora Lda');

    const confirmed = await ctx.http().post(`/api/reservation-groups/${group.id}/confirm`).set(reception).expect(200);
    expect(confirmed.body.reservations.every((reservation: { status: string }) => reservation.status === 'CONFIRMED')).toBe(true);
    await ctx.http().post(`/api/reservation-groups/${group.id}/confirm`).set(reception).expect(409);

    const lookup = await ctx.http().get('/api/reservation-groups/company').query({ taxId: '400555666' }).set(reception).expect(200);
    expect(lookup.body).toMatchObject({ companyName: 'Construtora Lda', companyAddress: 'Av. Marginal, Maputo' });

    const listed = await ctx.http().get('/api/reservations').query({ q: 'Construtora' }).set(reception).expect(200);
    expect(listed.body).toHaveLength(2);

    const cancelled = await ctx.http().post(`/api/reservation-groups/${group.id}/cancel`).set(reception).expect(200);
    expect(cancelled.body.reservations.every((reservation: { status: string }) => reservation.status === 'CANCELLED')).toBe(true);
  });

  it('a rececao cria uma reserva empresarial com varios quartos e funcionarios', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma, { rooms: 3 });
    const reception = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email)).auth;
    const existing = await ctx.prisma.guest.create({ data: { hotelId: hotel.id, firstName: 'Velho', lastName: 'Cliente', documentType: 'BI', documentNumber: `V${uid()}` } });
    const company = { name: 'Banco Sul', taxId: '400777888' };
    const base = { kind: 'CORPORATE', hotelId: hotel.id, company, checkIn: day(1), checkOut: day(3) };

    await ctx.http()
      .post('/api/reservation-groups')
      .set(reception)
      .send({ ...base, rooms: [{ roomId: rooms[0].id, adults: 1 }] })
      .expect(400);
    await ctx.http()
      .post('/api/reservation-groups')
      .set(reception)
      .send({ ...base, rooms: [{ roomId: rooms[0].id, adults: 1, guestId: existing.id }, { roomId: rooms[0].id, adults: 1, guestId: existing.id }] })
      .expect(400);

    const created = await ctx.http()
      .post('/api/reservation-groups')
      .set(reception)
      .send({
        ...base,
        rooms: [
          { roomId: rooms[0].id, adults: 1, guestId: existing.id },
          { roomId: rooms[1].id, adults: 1, occupant: { firstName: 'Nova', lastName: 'Funcionaria', documentType: 'BI', documentNumber: `N${uid()}` }, pricePerNight: 70 },
        ],
      })
      .expect(201);
    expect(created.body.reservations).toHaveLength(2);
    expect(created.body.reservations[1].pricePerNight).toBe('70');
    expect(created.body.reservations[1].guest.firstName).toBe('Nova');

    await ctx.http()
      .post('/api/reservation-groups')
      .set(reception)
      .send({ ...base, rooms: [{ roomId: rooms[2].id, adults: 1, guestId: existing.id }, { roomId: rooms[1].id, adults: 1, guestId: existing.id }] })
      .expect(409);
    expect(await ctx.prisma.reservation.count({ where: { roomId: rooms[2].id } })).toBe(0);

    await ctx.http()
      .post('/api/reservation-groups')
      .set(reception)
      .send({ kind: 'INDIVIDUAL', hotelId: hotel.id, checkIn: day(10), checkOut: day(11), rooms: [{ roomId: rooms[2].id, adults: 2 }] })
      .expect(400);
    const family = await ctx.http()
      .post('/api/reservation-groups')
      .set(reception)
      .send({ kind: 'INDIVIDUAL', guestId: existing.id, checkIn: day(10), checkOut: day(11), rooms: [{ roomId: rooms[2].id, adults: 2 }, { roomId: rooms[0].id, adults: 1 }] })
      .expect(201);
    expect(family.body.reservations.every((reservation: { guestId: number }) => reservation.guestId === existing.id)).toBe(true);

    const other = await createHotel(ctx.prisma);
    const outsider = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, other.hotel.id)).email)).auth;
    await ctx.http().get(`/api/reservation-groups/${created.body.id}`).set(outsider).expect(404);
  });
});

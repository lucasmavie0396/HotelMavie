import { UserRole } from '@prisma/client';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UploadsService } from '../src/uploads/uploads';
import { createApp, createHotel, createUser, day, login, TestContext } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
const dataUrl = (bytes: Buffer, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`;

describe('Site publico e sinal', () => {
  let ctx: TestContext;
  let uploadsDir: string;

  beforeAll(async () => {
    ctx = await createApp();
    uploadsDir = ctx.app.get(UploadsService).dir;
  });

  afterAll(() => ctx.app.close());

  async function staff(hotelId: number, role: UserRole = UserRole.RECEPTION) {
    const { email } = await createUser(ctx.prisma, role, hotelId);
    return (await login(ctx, email)).auth;
  }

  async function waitForLog(relatedId: number, kind: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const log = await ctx.prisma.emailLog.findFirst({ where: { relatedId, kind } });
      if (log) return log;
      await new Promise((done) => setTimeout(done, 100));
    }
    return null;
  }

  it('logotipo e fotografias: so imagens validas, ficheiros servidos e apagados', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    const auth = (await login(ctx, admin.email)).auth;
    const reception = await staff(hotel.id);

    await ctx.http().post(`/api/hotels/${hotel.id}/logo`).set(reception).send({ data: dataUrl(PNG) }).expect(403);
    await ctx.http().post(`/api/hotels/${hotel.id}/logo`).set(auth).send({ data: dataUrl(WEBP, 'image/webp') }).expect(400);
    await ctx.http().post(`/api/hotels/${hotel.id}/logo`).set(auth).send({ data: Buffer.from('<svg onload=alert(1)>').toString('base64') }).expect(400);
    const logo = await ctx.http().post(`/api/hotels/${hotel.id}/logo`).set(auth).send({ data: dataUrl(PNG) }).expect(201);
    expect(logo.body.logoFile).toMatch(/^[a-f0-9]{32}\.png$/);

    const file = await ctx.http().get(`/api/public/files/${logo.body.logoFile}`).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
    await ctx.http().get('/api/public/files/..%2F..%2F.env').expect(404);

    const manager = await staff(hotel.id, UserRole.MANAGER);
    const withImage = await ctx.http().post(`/api/rooms/${rooms[0].id}/images`).set(manager).send({ data: dataUrl(WEBP, 'image/webp') }).expect(201);
    expect(withImage.body.images).toHaveLength(1);
    await ctx.http().post(`/api/rooms/${rooms[0].id}/images`).set(reception).send({ data: dataUrl(PNG) }).expect(403);

    const other = await createHotel(ctx.prisma);
    const outsider = await staff(other.hotel.id, UserRole.MANAGER);
    await ctx.http().post(`/api/rooms/${rooms[0].id}/images`).set(outsider).send({ data: dataUrl(PNG) }).expect(404);

    const publicHotel = await ctx.http().get(`/api/public/hotels/${hotel.publicSlug}`).expect(200);
    expect(publicHotel.body.logoFile).toBe(logo.body.logoFile);
    expect(publicHotel.body.roomTypes.find((type: { type: string }) => type.type === 'Standard').images).toEqual([withImage.body.images[0].file]);

    const imageFile = withImage.body.images[0].file as string;
    await ctx.http().delete(`/api/rooms/${rooms[0].id}/images/${withImage.body.images[0].id}`).set(manager).expect(200);
    expect(existsSync(join(uploadsDir, imageFile))).toBe(false);
    await ctx.http().delete(`/api/hotels/${hotel.id}/logo`).set(auth).expect(200);
    expect(existsSync(join(uploadsDir, logo.body.logoFile))).toBe(false);
  });

  it('reserva online com sinal de 60%: exige referencia, rececao confirma e o restante fica para o check-out', async () => {
    const { hotel } = await createHotel(ctx.prisma, { depositPercent: 60 });
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { paymentInstructions: 'M-Pesa 840000000' } });
    const slug = hotel.publicSlug;

    const info = await ctx.http().get(`/api/public/hotels/${slug}`).expect(200);
    expect(info.body).toMatchObject({ depositPercent: 60, paymentInstructions: 'M-Pesa 840000000' });
    expect(info.body.paymentTypes.map((type: { name: string }) => type.name)).not.toContain('Numerario');
    const transfer = info.body.paymentTypes.find((type: { name: string }) => type.name === 'Transferencia');

    const availability = await ctx.http().get(`/api/public/hotels/${slug}/availability?checkIn=${day(20)}&checkOut=${day(23)}&guests=3`).expect(200);
    expect(availability.body[0]).toMatchObject({ type: 'Suite', total: '450.00', deposit: '270.00' });

    const payload = { checkIn: day(20), checkOut: day(23), roomType: 'Suite', adults: 3, firstName: 'Ana', lastName: 'Sinal', email: 'ana.sinal@teste.local', documentType: 'BI', documentNumber: '110100000002A' };
    await ctx.http().post(`/api/public/hotels/${slug}/reservations`).send(payload).expect(400);
    const cash = await ctx.prisma.paymentType.findFirstOrThrow({ where: { hotelId: hotel.id, kind: 'CASH' } });
    await ctx.http().post(`/api/public/hotels/${slug}/reservations`).send({ ...payload, depositReference: 'X1', depositPaymentTypeId: cash.id }).expect(400);
    const booked = await ctx.http()
      .post(`/api/public/hotels/${slug}/reservations`)
      .send({ ...payload, depositReference: 'TRF-778899', depositPaymentTypeId: transfer.id })
      .expect(201);
    expect(booked.body).toMatchObject({ status: 'PENDING', totalAmount: '450', depositAmount: '270', depositReference: 'TRF-778899' });
    const reservation = await ctx.prisma.reservation.findUniqueOrThrow({ where: { code: booked.body.code } });
    expect((await waitForLog(reservation.id, 'BOOKING_REQUEST'))?.subject).toContain(booked.body.code);

    const reception = await staff(hotel.id);
    await ctx.http().get(`/api/reservations/${reservation.id}/deposit/pdf`).set(reception).expect(409);
    await ctx.http().post(`/api/reservations/${reservation.id}/deposit/confirm`).set(reception).send({ amount: 500 }).expect(400);

    const confirmed = await ctx.http().post(`/api/reservations/${reservation.id}/deposit/confirm`).set(reception).send({}).expect(200);
    expect(confirmed.body).toMatchObject({
      status: 'CONFIRMED',
      depositAmount: '270',
      depositReference: 'TRF-778899',
      depositPaymentType: { name: 'Transferencia' },
    });
    expect(confirmed.body.depositConfirmedBy.name).toContain('RECEPTION');
    await ctx.http().post(`/api/reservations/${reservation.id}/deposit/confirm`).set(reception).send({}).expect(409);

    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: confirmed.body.depositPaymentId } });
    expect(payment).toMatchObject({ reservationId: reservation.id, reference: 'TRF-778899', paymentTypeId: transfer.id });
    expect(Number(payment.amount)).toBe(270);

    const log = await ctx.prisma.emailLog.findFirst({ where: { relatedId: reservation.id, kind: 'DEPOSIT_CONFIRMED' } });
    expect(log).toMatchObject({ recipient: 'ana.sinal@teste.local', status: 'LOGGED' });

    const pdf = await ctx.http().get(`/api/reservations/${reservation.id}/deposit/pdf`).set(reception).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const other = await createHotel(ctx.prisma);
    await ctx.http().get(`/api/reservations/${reservation.id}/deposit/pdf`).set(await staff(other.hotel.id)).expect(404);

    await ctx.prisma.reservation.update({ where: { id: reservation.id }, data: { checkIn: new Date(`${day(0)}T00:00:00Z`), checkOut: new Date(`${day(3)}T00:00:00Z`) } });
    await ctx.http().post(`/api/reservations/${reservation.id}/check-in`).set(reception).expect(200);
    const folio = await ctx.http().get(`/api/reservations/${reservation.id}/folio`).set(reception).expect(200);
    expect(Number(folio.body.balance)).toBe(180);
    await ctx.http().post(`/api/reservations/${reservation.id}/check-out`).set(reception).expect(409);
  });

  it('reserva feita em ingles: email, comprovativo, erros da API e textos do site em ingles', async () => {
    const { hotel } = await createHotel(ctx.prisma, { depositPercent: 50 });
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { publicDescriptionEn: 'Sea view hotel', paymentInstructionsEn: 'Bank transfer to IBAN X' } });
    const slug = hotel.publicSlug;
    const info = await ctx.http().get(`/api/public/hotels/${slug}`).expect(200);
    expect(info.body).toMatchObject({ publicDescriptionEn: 'Sea view hotel', paymentInstructionsEn: 'Bank transfer to IBAN X' });

    const payload = { checkIn: day(10), checkOut: day(12), roomType: 'Standard', adults: 2, firstName: 'John', lastName: 'Smith', email: 'john@teste.local', documentType: 'Passaporte', documentNumber: 'P1234567' };
    const missing = await ctx.http().post(`/api/public/hotels/${slug}/reservations`).set('X-Forwarded-For', '10.77.0.1').set('X-Lang', 'en').send({ ...payload, locale: 'en' }).expect(400);
    expect(missing.body.message).toBe('Enter the deposit payment reference (50% of the booking amount)');
    const portuguese = await ctx.http().post(`/api/public/hotels/${slug}/reservations`).set('X-Forwarded-For', '10.77.0.1').send({ ...payload, locale: 'en' }).expect(400);
    expect(portuguese.body.message).toContain('Indica a referencia');

    const booked = await ctx.http().post(`/api/public/hotels/${slug}/reservations`).set('X-Forwarded-For', '10.77.0.1').set('X-Lang', 'en').send({ ...payload, locale: 'en', depositReference: 'TX-1', depositPaymentTypeId: info.body.paymentTypes[0].id }).expect(201);
    const reservation = await ctx.prisma.reservation.findUniqueOrThrow({ where: { code: booked.body.code } });
    expect(reservation.locale).toBe('en');
    expect((await waitForLog(reservation.id, 'BOOKING_REQUEST'))?.subject).toBe(`Booking request ${booked.body.code} received - ${hotel.name}`);

    const reception = await staff(hotel.id);
    await ctx.http().post(`/api/reservations/${reservation.id}/deposit/confirm`).set(reception).send({}).expect(200);
    expect((await ctx.prisma.emailLog.findFirst({ where: { relatedId: reservation.id, kind: 'DEPOSIT_CONFIRMED' } }))?.subject).toContain('deposit received');
    const pdf = await ctx.http().get(`/api/reservations/${reservation.id}/deposit/pdf`).set(reception).buffer(true).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('sinal registado ao balcao, em numerario exige caixa aberta', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma, { depositPercent: 50 });
    const reception = await staff(hotel.id);
    const guest = await ctx.prisma.guest.create({ data: { hotelId: hotel.id, firstName: 'Balcao', lastName: 'Sinal' } });
    const created = await ctx.http().post('/api/reservations').set(reception).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(10), checkOut: day(12) }).expect(201);
    expect(created.body.depositAmount).toBeNull();

    await ctx.http().get(`/api/payment-types?hotelId=${hotel.id}`).set(reception).expect(200);
    const cash = await ctx.prisma.paymentType.findFirstOrThrow({ where: { hotelId: hotel.id, kind: 'CASH' } });
    await ctx.http().post(`/api/reservations/${created.body.id}/deposit/confirm`).set(reception).send({ paymentTypeId: cash.id }).expect(400);

    const card = await ctx.prisma.paymentType.findFirstOrThrow({ where: { hotelId: hotel.id, kind: 'CARD' } });
    const confirmed = await ctx.http().post(`/api/reservations/${created.body.id}/deposit/confirm`).set(reception).send({ paymentTypeId: card.id }).expect(200);
    expect(confirmed.body).toMatchObject({ status: 'CONFIRMED', depositAmount: '80' });
    await ctx.http().post(`/api/reservations/${created.body.id}/deposit/email`).set(reception).expect(400);
  });

  it('impressora instalada no computador devolve ESC/POS para o agente local', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = await staff(hotel.id, UserRole.MANAGER);
    await ctx.http().post('/api/printers').set(manager).send({ hotelId: hotel.id, name: 'Sem nome', purpose: 'RECEIPT', connection: 'LOCAL' }).expect(400);
    const printer = await ctx.http()
      .post('/api/printers')
      .set(manager)
      .send({ hotelId: hotel.id, name: 'Termica balcao', purpose: 'RECEIPT', connection: 'LOCAL', localName: 'POS-80 (USB)', paperWidth: 'MM58', copies: 2 })
      .expect(201);
    const result = await ctx.http().post(`/api/printers/${printer.body.id}/test`).set(manager).expect(200);
    expect(result.body).toMatchObject({ status: 'local', copies: 2, printer: { localName: 'POS-80 (USB)' } });
    const bytes = Buffer.from(result.body.data, 'base64');
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(bytes.includes(Buffer.from('PAGINA DE TESTE'))).toBe(true);

    await ctx.http().patch(`/api/printers/${printer.body.id}`).set(manager).send({ localName: null }).expect(400);
    await ctx.http().patch(`/api/printers/${printer.body.id}`).set(manager).send({ paperWidth: 'A4' }).expect(200);
    const a4 = await ctx.http().post(`/api/printers/${printer.body.id}/test`).set(manager).expect(200);
    expect(a4.body).toMatchObject({ status: 'browser', paper: 'A4' });
  });
});

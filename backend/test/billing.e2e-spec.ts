import { UserRole } from '@prisma/client';
import { createVerify } from 'node:crypto';
import { signatureMessage } from '../src/at/at-format';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Faturacao, conta do hospede e caixa', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function checkedIn(hotelId: number, roomId: number) {
    const guest = await createGuest(ctx.prisma, hotelId);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId, checkIn: day(0), checkOut: day(2) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    return reservation.body.id as number;
  }

  it('lanca o alojamento com IVA no check-in e bloqueia o check-out com saldo', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma, { accommodationRate: 6 });
    const id = await checkedIn(hotel.id, rooms[0].id);

    const folio = await ctx.http().get(`/api/reservations/${id}/folio`).set(auth).expect(200);
    expect(folio.body.charges).toHaveLength(1);
    expect(folio.body.charges[0]).toMatchObject({ type: 'ACCOMMODATION', total: '160', taxRate: '6' });
    expect(folio.body.balance).toBe('160');

    const blocked = await ctx.http().post(`/api/reservations/${id}/check-out`).set(auth).expect(409);
    expect(blocked.body.message).toContain('160.00');

    await ctx.http().patch(`/api/reservations/${id}`).set(auth).send({ checkOut: day(3) }).expect(200);
    const extended = await ctx.http().get(`/api/reservations/${id}/folio`).set(auth).expect(200);
    expect(extended.body.chargesTotal).toBe('240');
  });

  it('emite fatura com totais certos, numeracao sequencial e hash encadeado', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma, { accommodationRate: 6 });
    const t23 = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 23 } });
    const id = await checkedIn(hotel.id, rooms[0].id);
    await ctx.http().post(`/api/reservations/${id}/charges`).set(auth).send({ description: 'Minibar', quantity: 2, unitPrice: 3.5, taxRateId: t23.id }).expect(201);

    const first = await ctx.http().post(`/api/reservations/${id}/invoices`).set(auth).send({ type: 'INVOICE' }).expect(201);
    expect(first.body).toMatchObject({ grossTotal: '167', netTotal: '156.63', taxTotal: '10.37' });
    expect(first.body.number).toBe(1);
    await ctx.http().post(`/api/reservations/${id}/invoices`).set(auth).send({}).expect(400);

    const note = await ctx.http().post(`/api/invoices/${first.body.id}/credit-note`).set(auth).send({ reason: 'NIF errado' }).expect(201);
    expect(note.body).toMatchObject({ type: 'CREDIT_NOTE', grossTotal: '167', previousHash: null });
    await ctx.http().post(`/api/invoices/${first.body.id}/credit-note`).set(auth).send({ reason: 'outra vez' }).expect(409);

    const second = await ctx.http().post(`/api/reservations/${id}/invoices`).set(auth).send({ customerTaxId: '123456789' }).expect(201);
    expect(second.body.number).toBe(2);
    expect(second.body.fullNumber).toMatch(/^FT \d{4}\/2$/);
    expect(second.body.previousHash).toBe(first.body.hash);
    const publicKey = (await ctx.http().get('/api/at/public-key').set(auth).expect(200)).text;
    const message = signatureMessage({
      issuedAt: new Date(second.body.issuedAt),
      invoiceNo: second.body.fullNumber,
      grossTotal: { toFixed: () => '167.00' },
      previousHash: first.body.hash,
    });
    expect(createVerify('RSA-SHA1').update(message).verify(publicKey, second.body.hash, 'base64')).toBe(true);
    expect(createVerify('RSA-SHA1').update(message.replace('167.00', '168.00')).verify(publicKey, second.body.hash, 'base64')).toBe(false);
  });

  it('faturas emitidas em simultaneo nao repetem nem saltam numeros', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma, { rooms: 5 });
    const ids = [];
    for (const room of rooms) ids.push(await checkedIn(hotel.id, room.id));
    const responses = await Promise.all(ids.map((id) => ctx.http().post(`/api/reservations/${id}/invoices`).set(auth).send({})));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const numbers = responses.map((r) => r.body.number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);

    const invoices = await ctx.prisma.invoice.findMany({ where: { hotelId: hotel.id }, orderBy: { number: 'asc' } });
    for (let index = 1; index < invoices.length; index++) {
      expect(invoices[index].previousHash).toBe(invoices[index - 1].hash);
    }
  });

  it('sem caixa aberto pelo operador nao vende nem recebe, e o fecho calcula a diferenca', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const id = await checkedIn(hotel.id, rooms[0].id);
    const cashier = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id, { cash: false })).email)).auth;
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 16 } });
    const product = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Agua', price: 1, taxRateId: rate.id } });
    const order = await ctx.http().post('/api/orders').set(cashier).send({ hotelId: hotel.id, outlet: 'BAR' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(cashier).send({ productId: product.id, quantity: 1 }).expect(201);

    await ctx.http().post(`/api/reservations/${id}/payments`).set(cashier).send({ amount: 50, method: 'CARD' }).expect(409);
    await ctx.http().post(`/api/reservations/${id}/invoices`).set(cashier).send({}).expect(409);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(cashier).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 1 }] }).expect(409);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(cashier).send({ mode: 'ROOM', reservationId: id }).expect(409);

    const register = await ctx.http().post('/api/cash-registers').set(cashier).send({ hotelId: hotel.id, name: 'Rececao' }).expect(201);
    const session = await ctx.http().post(`/api/cash-registers/${register.body.id}/open`).set(cashier).send({ openingAmount: 100 }).expect(201);
    await ctx.http().post(`/api/cash-registers/${register.body.id}/open`).set(cashier).send({ openingAmount: 0 }).expect(409);

    const paid = await ctx.http().post(`/api/reservations/${id}/payments`).set(cashier).send({ amount: 60, method: 'CASH' }).expect(201);
    expect(paid.body.cashSessionId).toBe(session.body.id);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(cashier).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 1 }] }).expect(200);
    await ctx.http().post(`/api/cash-sessions/${session.body.id}/movements`).set(cashier).send({ type: 'OUT', amount: 15, description: 'Troco' }).expect(201);
    const closed = await ctx.http().post(`/api/cash-sessions/${session.body.id}/close`).set(cashier).send({ countedAmount: 140 }).expect(200);
    expect(closed.body).toMatchObject({ expectedAmount: '145', countedAmount: '140', difference: '-5' });

    await ctx.http().post(`/api/reservations/${id}/payments`).set(cashier).send({ amount: 1, method: 'CARD' }).expect(409);
    await ctx.http().post(`/api/reservations/${id}/payments`).set(auth).send({ amount: 1, method: 'CASH', cashSessionId: session.body.id }).expect(409);
  });

  it('rececao nao pode fazer devolucoes nem notas de credito', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const id = await checkedIn(hotel.id, rooms[0].id);
    const invoice = await ctx.http().post(`/api/reservations/${id}/invoices`).set(auth).send({}).expect(201);
    const staff = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const staffAuth = (await login(ctx, staff.email)).auth;

    await ctx.http().post(`/api/reservations/${id}/payments`).set(staffAuth).send({ amount: -10, method: 'CARD' }).expect(403);
    await ctx.http().post(`/api/invoices/${invoice.body.id}/credit-note`).set(staffAuth).send({ reason: 'teste' }).expect(403);
    await ctx.http().delete(`/api/charges/${(await ctx.prisma.charge.findFirstOrThrow({ where: { reservationId: id } })).id}`).set(staffAuth).expect(403);
  });

  it('gera o PDF da fatura', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const id = await checkedIn(hotel.id, rooms[0].id);
    const invoice = await ctx.http().post(`/api/reservations/${id}/invoices`).set(auth).send({}).expect(201);
    const pdf = await ctx.http().get(`/api/invoices/${invoice.body.id}/pdf`).set(auth).responseType('blob').expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  });
});

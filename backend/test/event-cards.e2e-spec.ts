import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, login, TestContext } from './helpers';

describe('Cartoes Evento', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    auth = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function setup() {
    const { hotel } = await createHotel(ctx.prisma);
    const cash = await ctx.prisma.paymentType.create({ data: { hotelId: hotel.id, name: 'Numerario', kind: 'CASH' } });
    const mobile = await ctx.prisma.paymentType.create({ data: { hotelId: hotel.id, name: 'M-Pesa', kind: 'MOBILE' } });
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 16 } });
    const beer = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Cerveja', price: 100, taxRateId: rate.id } });
    return { hotel, cash, mobile, beer };
  }

  it('regista, carrega e recarrega pelo caixa, paga no POS e nao deixa ficar negativo', async () => {
    const { hotel, cash, mobile, beer } = await setup();
    await ctx.http().post('/api/event-cards').set(auth).send({ hotelId: hotel.id, number: '12', amount: 0 }).expect(400);
    await ctx.http().post('/api/event-cards').set(auth).send({ hotelId: hotel.id, number: '1001', amount: 500 }).expect(400);
    const card = await ctx.http()
      .post('/api/event-cards')
      .set(auth)
      .send({ hotelId: hotel.id, number: ';1001=4912?', holder: 'Mesa VIP', amount: 500, paymentTypeId: cash.id })
      .expect(201);
    expect(card.body).toMatchObject({ number: '1001', holder: 'Mesa VIP', balance: '500', active: true });
    await ctx.http().post('/api/event-cards').set(auth).send({ hotelId: hotel.id, number: '1001' }).expect(409);

    const key = 'recarga-teste-0001';
    const top = await ctx.http().post(`/api/event-cards/${card.body.id}/topup`).set(auth).send({ amount: 200, paymentTypeId: mobile.id, reference: 'MP123', idempotencyKey: key }).expect(200);
    expect(top.body.card.balance).toBe('700');
    const again = await ctx.http().post(`/api/event-cards/${card.body.id}/topup`).set(auth).send({ amount: 200, paymentTypeId: mobile.id, reference: 'MP123', idempotencyKey: key }).expect(200);
    expect(again.body).toMatchObject({ movementId: top.body.movementId, card: { balance: '700' } });
    expect(await ctx.prisma.payment.count({ where: { hotelId: hotel.id, invoiceId: null } })).toBe(2);

    const cardType = await ctx.prisma.paymentType.findFirstOrThrow({ where: { hotelId: hotel.id, isEventCard: true } });
    await ctx.http().post(`/api/event-cards/${card.body.id}/topup`).set(auth).send({ amount: 10, paymentTypeId: cardType.id }).expect(400);

    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'BAR' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: beer.id, quantity: 8 }).expect(201);
    const pay = (number?: string) => ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'PAY', payments: [{ paymentTypeId: cardType.id, amount: 800, eventCardNumber: number }] });
    await pay().expect(400);
    const short = await pay('1001').expect(409);
    expect(short.body.message).toContain('Saldo insuficiente');
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.body.id } })).status).toBe('OPEN');

    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: beer.id, quantity: -1 }).expect(400);
    const second = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'BAR' }).expect(201);
    await ctx.http().post(`/api/orders/${second.body.id}/items`).set(auth).send({ productId: beer.id, quantity: 3 }).expect(201);
    await ctx.http()
      .post(`/api/orders/${second.body.id}/close`)
      .set(auth)
      .send({ mode: 'PAY', payments: [{ paymentTypeId: cardType.id, amount: 300, eventCardNumber: '1001' }] })
      .expect(200);
    const after = await ctx.http().get(`/api/event-cards/${card.body.id}/movements`).set(auth).expect(200);
    expect(after.body.card.balance).toBe('400');
    expect(after.body.items.map((item: { type: string }) => item.type)).toEqual(['PAYMENT', 'TOPUP', 'LOAD']);
    expect(after.body).toMatchObject({ credit: '700', debit: '300' });

    const receipt = await ctx.http().get(`/api/event-cards/movements/${top.body.movementId}/receipt`).set(auth).buffer(true).expect(200);
    expect(receipt.headers['content-type']).toBe('application/pdf');
    const labels = await ctx.http().post('/api/event-cards/labels').set(auth).send({ ids: [card.body.id] }).buffer(true).expect(200);
    expect(labels.headers['content-type']).toBe('application/pdf');

    const guest = await createGuest(ctx.prisma, hotel.id);
    await ctx.http().post('/api/reservations/0/payments').set(auth).send({ amount: 1, paymentTypeId: cardType.id }).expect((res) => expect([400, 404]).toContain(res.status));
    await ctx.http().post(`/api/event-cards/${card.body.id}/guest`).set(auth).send({ guestId: guest.id }).expect(200);
    const statement = await ctx.http().get(`/api/event-cards/guests/${guest.id}/statement`).set(auth).expect(200);
    expect(statement.body.balance).toBe('400');
  });

  it('transfere o saldo para outro cartao e descarrega com devolucao so por gestor', async () => {
    const { hotel, cash } = await setup();
    const lost = await ctx.http().post('/api/event-cards').set(auth).send({ hotelId: hotel.id, number: 'A-0001', amount: 150, paymentTypeId: cash.id }).expect(201);
    const fresh = await ctx.http().post('/api/event-cards').set(auth).send({ hotelId: hotel.id, number: 'A-0002' }).expect(201);
    const moved = await ctx.http().post(`/api/event-cards/${lost.body.id}/transfer`).set(auth).send({ toNumber: 'a-0002', block: true, reason: 'Cartao perdido' }).expect(200);
    expect(moved.body.source).toMatchObject({ balance: '0', active: false });
    expect(moved.body.target.balance).toBe('150');
    await ctx.http().post(`/api/event-cards/${fresh.body.id}/transfer`).set(auth).send({ toNumber: 'A-0001', reason: 'Teste' }).expect(409);

    const cashier = await createUser(ctx.prisma, UserRole.CASHIER, hotel.id);
    const cashierAuth = (await login(ctx, cashier.email)).auth;
    const list = await ctx.http().get('/api/event-cards').query({ hotelId: hotel.id }).set(cashierAuth).expect(200);
    expect(list.body).toHaveLength(2);
    await ctx.http().post('/api/event-cards/discharge').set(cashierAuth).send({ hotelId: hotel.id, cards: [{ id: fresh.body.id, balance: 150 }], refund: false, reason: 'Fim do evento' }).expect(403);

    const balances = await ctx.http().get('/api/event-cards/discharge/balances').query({ hotelId: hotel.id }).set(auth).expect(200);
    expect(balances.body).toMatchObject({ total: '150' });
    await ctx.http().post('/api/event-cards/discharge').set(auth).send({ hotelId: hotel.id, cards: [{ id: fresh.body.id, balance: 100 }], refund: true, paymentTypeId: cash.id, reason: 'Fim do evento' }).expect(409);
    const discharge = await ctx.http()
      .post('/api/event-cards/discharge')
      .set(auth)
      .send({ hotelId: hotel.id, cards: [{ id: fresh.body.id, balance: 150 }], refund: true, paymentTypeId: cash.id, reason: 'Fim do evento' })
      .expect(201);
    expect(discharge.body).toMatchObject({ refunded: true, total: '150', cards: 1 });
    expect((await ctx.prisma.eventCard.findUniqueOrThrow({ where: { id: fresh.body.id } })).balance.toString()).toBe('0');
    const refundPayment = await ctx.prisma.payment.findFirstOrThrow({ where: { hotelId: hotel.id, amount: { lt: 0 } } });
    expect(refundPayment.amount.toString()).toBe('-150');
  });
});

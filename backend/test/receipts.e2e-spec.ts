import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Recibos e contas correntes', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function companyInvoice(hotelId: number, roomId: number, taxId = '508000001', type = 'INVOICE') {
    const guest = await createGuest(ctx.prisma, hotelId);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId, checkIn: day(0), checkOut: day(1) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    const invoice = await ctx.http()
      .post(`/api/reservations/${reservation.body.id}/invoices`)
      .set(auth)
      .send({ type, customerName: `Empresa ${taxId}`, customerTaxId: taxId })
      .expect(201);
    return { reservationId: reservation.body.id as number, invoice: invoice.body };
  }

  const receipt = (hotelId: number, lines: object[], extra: object = {}) =>
    ctx.http().post('/api/receipts').set(auth).send({ hotelId, method: 'CARD', lines, ...extra });

  it('fatura a pagar passa para a conta corrente e liberta o check-out', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const { reservationId, invoice } = await companyInvoice(hotel.id, rooms[0].id);

    const folio = await ctx.http().get(`/api/reservations/${reservationId}/folio`).set(auth).expect(200);
    expect(folio.body).toMatchObject({ balance: '0', customerAccountTotal: '80' });
    await ctx.http().post(`/api/reservations/${reservationId}/check-out`).set(auth).expect(200);

    const accounts = await ctx.http().get(`/api/accounts?hotelId=${hotel.id}`).set(auth).expect(200);
    expect(accounts.body).toEqual([expect.objectContaining({ customerKey: 'NIF:508000001', open: '80', invoices: 1 })]);
    const open = await ctx.http().get(`/api/invoices-open?hotelId=${hotel.id}&customer=NIF:508000001`).set(auth).expect(200);
    expect(open.body.map((i: { id: number }) => i.id)).toEqual([invoice.id]);
  });

  it('recibos parciais liquidam a fatura sem a ultrapassar', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const { invoice } = await companyInvoice(hotel.id, rooms[0].id);

    const first = await receipt(hotel.id, [{ invoiceId: invoice.id, amount: 30 }]).expect(201);
    expect(first.body.fullNumber).toMatch(/^RG \d{4}\/1$/);
    await receipt(hotel.id, [{ invoiceId: invoice.id, amount: 60 }]).expect(400);

    const register = await ctx.prisma.cashRegister.create({ data: { hotelId: hotel.id, name: 'Rececao' } });
    const session = await ctx.prisma.cashSession.create({ data: { registerId: register.id, openingAmount: 0 } });
    const second = await receipt(hotel.id, [{ invoiceId: invoice.id, amount: 50 }], { method: 'CASH', cashSessionId: session.id }).expect(201);
    expect(second.body.fullNumber).toMatch(/^RG \d{4}\/2$/);

    const open = await ctx.http().get(`/api/invoices-open?hotelId=${hotel.id}`).set(auth).expect(200);
    expect(open.body).toHaveLength(0);
    const payments = await ctx.prisma.payment.findMany({ where: { hotelId: hotel.id, receiptId: { not: null } } });
    expect(payments.map((p) => [p.method, p.amount.toString(), p.cashSessionId])).toEqual([
      ['CARD', '30', null],
      ['CASH', '50', session.id],
    ]);
  });

  it('nao mistura clientes nem aceita faturas-recibo', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const a = await companyInvoice(hotel.id, rooms[0].id, '508000001');
    const b = await companyInvoice(hotel.id, rooms[1].id, '508000002');
    const fr = await companyInvoice(hotel.id, rooms[2].id, '508000001', 'INVOICE_RECEIPT');
    await receipt(hotel.id, [{ invoiceId: a.invoice.id, amount: 10 }, { invoiceId: b.invoice.id, amount: 10 }]).expect(400);
    await receipt(hotel.id, [{ invoiceId: fr.invoice.id, amount: 10 }]).expect(409);
  });

  it('recibos em simultaneo pelo valor total so passam uma vez', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const { invoice } = await companyInvoice(hotel.id, rooms[0].id);
    const responses = await Promise.all(Array.from({ length: 4 }, () => receipt(hotel.id, [{ invoiceId: invoice.id, amount: 80 }])));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 400)).toHaveLength(3);
  });

  it('anular recibo devolve o pagamento e so depois se pode creditar a fatura', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const { invoice } = await companyInvoice(hotel.id, rooms[0].id);
    const paid = await receipt(hotel.id, [{ invoiceId: invoice.id, amount: 80 }]).expect(201);

    await ctx.http().post(`/api/invoices/${invoice.id}/credit-note`).set(auth).send({ reason: 'Erro' }).expect(409);

    const staff = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const staffAuth = (await login(ctx, staff.email)).auth;
    await ctx.http().post(`/api/receipts/${paid.body.id}/cancel`).set(staffAuth).send({ reason: 'Engano' }).expect(403);

    const cancelled = await ctx.http().post(`/api/receipts/${paid.body.id}/cancel`).set(auth).send({ reason: 'Engano no valor' }).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    await ctx.http().post(`/api/receipts/${paid.body.id}/cancel`).set(auth).send({ reason: 'outra vez' }).expect(409);
    const payments = await ctx.prisma.payment.findMany({ where: { receiptId: paid.body.id }, orderBy: { id: 'asc' } });
    expect(payments.map((p) => p.amount.toString())).toEqual(['80', '-80']);

    const open = await ctx.http().get(`/api/invoices-open?hotelId=${hotel.id}`).set(auth).expect(200);
    expect(open.body[0].open).toBe('80');
    await ctx.http().post(`/api/invoices/${invoice.id}/credit-note`).set(auth).send({ reason: 'Erro' }).expect(201);
  });

  it('recibos entram no SAF-T e tem PDF de uma pagina', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { taxId: '500100200', city: 'Porto', postalCode: '4000-001', address: 'Rua 1' } });
    const { invoice } = await companyInvoice(hotel.id, rooms[0].id);
    const paid = await receipt(hotel.id, [{ invoiceId: invoice.id, amount: 80 }], { reference: 'TPA 77' }).expect(201);

    const pdf = await ctx.http().get(`/api/receipts/${paid.body.id}/pdf`).set(auth).responseType('blob').expect(200);
    expect((pdf.body.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);

    const xml = (await ctx.http().get(`/api/saft?hotelId=${hotel.id}&from=${day(0)}&to=${day(0)}`).set(auth).expect(200)).text;
    expect(xml).toMatch(/<Payments>\s*<NumberOfEntries>1<\/NumberOfEntries>\s*<TotalDebit>0\.00<\/TotalDebit>\s*<TotalCredit>80\.00<\/TotalCredit>/);
    expect(xml).toMatch(/<PaymentRefNo>RG \d{4}\/1<\/PaymentRefNo>/);
    expect(xml).toContain('<PaymentType>RG</PaymentType>');
    expect(xml).toContain('<PaymentMechanism>CC</PaymentMechanism><PaymentAmount>80.00</PaymentAmount>');
    expect(xml).toContain(`<OriginatingON>${invoice.fullNumber}</OriginatingON>`);
    expect(xml).toContain('<TotalCredit>80.00</TotalCredit>');
  });
});

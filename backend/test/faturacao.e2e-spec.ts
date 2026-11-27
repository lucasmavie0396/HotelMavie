import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Faturacao como no LAMGest (faturas manuais, cotacoes, notas de credito parciais)', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function setup() {
    const { hotel } = await createHotel(ctx.prisma);
    const iva = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'IVA 16%', rate: 16, atCategory: 'NOR' } });
    const product = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Sala de reunioes', price: 1000, taxRateId: iva.id } });
    return { hotel, iva, product };
  }

  it('emite fatura manual a credito com linhas de produto, livres e desconto', async () => {
    const { hotel, iva, product } = await setup();
    await ctx.http().post('/api/invoices').set(auth).send({ hotelId: hotel.id, lines: [{ productId: product.id, quantity: 1 }] }).expect(400);
    const invoice = await ctx.http()
      .post('/api/invoices')
      .set(auth)
      .send({
        hotelId: hotel.id,
        customerName: 'Empresa Alfa',
        customerTaxId: '400000001',
        dueDate: day(30),
        notes: 'Evento de 3 dias',
        lines: [
          { productId: product.id, quantity: 2, discount: 100 },
          { description: 'Coffee break', quantity: 10, unitPrice: 150, taxRateId: iva.id },
        ],
      })
      .expect(201);
    expect(invoice.body).toMatchObject({ type: 'INVOICE', grossTotal: '3400', notes: 'Evento de 3 dias', customerName: 'Empresa Alfa' });
    expect(invoice.body.fullNumber).toMatch(/^FT \d{4}\/1$/);
    expect(invoice.body.lines.map((line: { description: string; grossAmount: string }) => [line.description, line.grossAmount])).toEqual([
      ['Sala de reunioes (desconto 100.00)', '1900'],
      ['Coffee break', '1500'],
    ]);

    const unpaid = await ctx.http().get(`/api/invoices?hotelId=${hotel.id}&unpaid=true`).set(auth).expect(200);
    expect(unpaid.body).toEqual([expect.objectContaining({ id: invoice.body.id, open: '3400' })]);
    const accounts = await ctx.http().get(`/api/accounts?hotelId=${hotel.id}`).set(auth).expect(200);
    expect(accounts.body).toEqual([expect.objectContaining({ customerKey: 'NIF:400000001', open: '3400' })]);
  });

  it('fatura manual exige o caixa do operador aberto', async () => {
    const { hotel, product } = await setup();
    const reception = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id, { cash: false });
    const own = (await login(ctx, reception.email)).auth;
    await ctx.http().post('/api/invoices').set(own).send({ customerName: 'Empresa Beta', lines: [{ productId: product.id, quantity: 1 }] }).expect(409);
  });

  it('cotacao numerada por ano, convertida em fatura uma so vez', async () => {
    const { hotel, product } = await setup();
    const quote = await ctx.http()
      .post('/api/quotes')
      .set(auth)
      .send({ hotelId: hotel.id, validUntil: day(15), lines: [{ productId: product.id, quantity: 3, discount: 300 }] })
      .expect(201);
    expect(quote.body).toMatchObject({ status: 'OPEN', customerName: 'Consumidor final', grossTotal: '2700', expired: false });
    expect(quote.body.fullNumber).toMatch(/^CT \d{4}\/1$/);
    const second = await ctx.http().post('/api/quotes').set(auth).send({ hotelId: hotel.id, validUntil: day(15), lines: [{ productId: product.id, quantity: 1 }] }).expect(201);
    expect(second.body.fullNumber).toMatch(/^CT \d{4}\/2$/);
    await ctx.http().post('/api/quotes').set(auth).send({ hotelId: hotel.id, validUntil: day(-1), lines: [{ productId: product.id, quantity: 1 }] }).expect(400);

    await ctx.http().post(`/api/quotes/${quote.body.id}/convert`).set(auth).send({}).expect(400);
    const invoice = await ctx.http()
      .post(`/api/quotes/${quote.body.id}/convert`)
      .set(auth)
      .send({ customerName: 'Empresa Gama', customerTaxId: '400000003', dueDate: day(30) })
      .expect(201);
    expect(invoice.body).toMatchObject({ type: 'INVOICE', grossTotal: '2700', customerName: 'Empresa Gama' });
    await ctx.http().post(`/api/quotes/${quote.body.id}/convert`).set(auth).send({ customerName: 'Empresa Gama' }).expect(409);

    const converted = await ctx.http().get(`/api/quotes/${quote.body.id}`).set(auth).expect(200);
    expect(converted.body).toMatchObject({ status: 'CONVERTED', invoice: { id: invoice.body.id } });
    const detail = await ctx.http().get(`/api/invoices/${invoice.body.id}/detail`).set(auth).expect(200);
    expect(detail.body).toMatchObject({ quote: { id: quote.body.id }, open: '2700' });

    await ctx.http().post(`/api/quotes/${second.body.id}/cancel`).set(auth).send({ reason: 'Cliente desistiu' }).expect(200);
    await ctx.http().post(`/api/quotes/${second.body.id}/convert`).set(auth).send({ customerName: 'Empresa Gama' }).expect(409);
    const cancelled = await ctx.http().get(`/api/quotes?hotelId=${hotel.id}&status=CANCELLED`).set(auth).expect(200);
    expect(cancelled.body.map((item: { id: number }) => item.id)).toEqual([second.body.id]);

    for (const paper of ['A4', 'MM80']) {
      const pdf = await ctx.http().get(`/api/print/pdf?document=QUOTE&quoteId=${quote.body.id}&paper=${paper}`).set(auth).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
    }
  });

  it('nota de credito parcial reduz a divida e a total fecha a fatura', async () => {
    const { hotel, iva } = await setup();
    const invoice = await ctx.http()
      .post('/api/invoices')
      .set(auth)
      .send({
        hotelId: hotel.id,
        customerName: 'Empresa Delta',
        lines: [
          { description: 'Quarto extra', quantity: 3, unitPrice: 100, taxRateId: iva.id },
          { description: 'Lavandaria', quantity: 1, unitPrice: 50, taxRateId: iva.id },
        ],
      })
      .expect(201);
    const [rooms, laundry] = invoice.body.lines;

    await ctx.http().post(`/api/invoices/${invoice.body.id}/credit-note`).set(auth).send({ reason: 'Erro', lines: [{ lineId: rooms.id, quantity: 4 }] }).expect(400);
    const partial = await ctx.http()
      .post(`/api/invoices/${invoice.body.id}/credit-note`)
      .set(auth)
      .send({ reason: 'Um quarto nao usado', lines: [{ lineId: rooms.id, quantity: 1 }] })
      .expect(201);
    expect(partial.body).toMatchObject({ type: 'CREDIT_NOTE', grossTotal: '100' });

    let detail = await ctx.http().get(`/api/invoices/${invoice.body.id}/detail`).set(auth).expect(200);
    expect(detail.body).toMatchObject({ status: 'ISSUED', open: '250' });
    expect(detail.body.lines.map((line: { creditedQuantity: string }) => line.creditedQuantity)).toEqual(['1', '0']);
    const open = await ctx.http().get(`/api/invoices-open?hotelId=${hotel.id}`).set(auth).expect(200);
    expect(open.body).toEqual([expect.objectContaining({ id: invoice.body.id, open: '250' })]);
    await ctx.http().post('/api/receipts').set(auth).send({ hotelId: hotel.id, method: 'CARD', lines: [{ invoiceId: invoice.body.id, amount: 300 }] }).expect(400);

    const rest = await ctx.http().post(`/api/invoices/${invoice.body.id}/credit-note`).set(auth).send({ reason: 'Evento cancelado' }).expect(201);
    expect(rest.body.grossTotal).toBe('250');
    expect(rest.body.lines.map((line: { description: string; quantity: string }) => [line.description, line.quantity])).toEqual([
      [rooms.description, '2'],
      [laundry.description, '1'],
    ]);
    detail = await ctx.http().get(`/api/invoices/${invoice.body.id}/detail`).set(auth).expect(200);
    expect(detail.body).toMatchObject({ status: 'CREDITED', open: '0' });
    await ctx.http().post(`/api/invoices/${invoice.body.id}/credit-note`).set(auth).send({ reason: 'Outra vez' }).expect(409);
  });

  it('fatura-recibo so aceita nota de credito total', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const guest = await ctx.prisma.guest.create({ data: { hotelId: hotel.id, firstName: 'Ana', lastName: 'Silva' } });
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(0), checkOut: day(1) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    const fr = await ctx.http().post(`/api/reservations/${reservation.body.id}/invoices`).set(auth).send({ type: 'INVOICE_RECEIPT' }).expect(201);
    await ctx.http()
      .post(`/api/invoices/${fr.body.id}/credit-note`)
      .set(auth)
      .send({ reason: 'Erro', lines: [{ lineId: fr.body.lines[0].id, quantity: 1 }] })
      .expect(400);
  });

  it('lista os recibos com filtros', async () => {
    const { hotel, iva } = await setup();
    const invoice = await ctx.http()
      .post('/api/invoices')
      .set(auth)
      .send({ hotelId: hotel.id, customerName: 'Empresa Omega', lines: [{ description: 'Servico', quantity: 1, unitPrice: 100, taxRateId: iva.id }] })
      .expect(201);
    await ctx.http().post('/api/receipts').set(auth).send({ hotelId: hotel.id, method: 'CARD', lines: [{ invoiceId: invoice.body.id, amount: 100 }] }).expect(201);
    const found = await ctx.http().get(`/api/receipts?hotelId=${hotel.id}&q=Omega&from=${day(-1)}&to=${day(1)}`).set(auth).expect(200);
    expect(found.body).toHaveLength(1);
    const none = await ctx.http().get(`/api/receipts?hotelId=${hotel.id}&status=CANCELLED`).set(auth).expect(200);
    expect(none.body).toHaveLength(0);
  });
});

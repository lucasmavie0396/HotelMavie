import { UserRole } from '@prisma/client';
import { AddressInfo, createServer, Server } from 'node:net';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

const CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00]);

function fakePrinter() {
  const jobs: Buffer[] = [];
  const server: Server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => jobs.push(Buffer.concat(chunks)));
  });
  return new Promise<{ port: number; jobs: Buffer[]; close: () => Promise<void> }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: (server.address() as AddressInfo).port, jobs, close: () => new Promise((done) => server.close(() => done())) }),
    ),
  );
}

const count = (haystack: Buffer, needle: Buffer) => {
  let total = 0;
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + 1)) total++;
  return total;
};
const waitFor = async (jobs: Buffer[], amount: number) => {
  for (let i = 0; i < 40 && jobs.length < amount; i++) await new Promise((done) => setTimeout(done, 50));
};
const width = (pdf: Buffer) => /\/MediaBox \[0 0 ([\d.]+)/.exec(pdf.toString('latin1'))?.[1];

describe('Impressoras e tipos de pagamento', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  const addPrinter = (body: object) => ctx.http().post('/api/printers').set(auth).send(body);

  it('imprime na impressora de rede em ESC/POS, com copias e corte', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const device = await fakePrinter();
    try {
      await addPrinter({ hotelId: hotel.id, name: 'Sem IP', purpose: 'RECEIPT', connection: 'NETWORK' }).expect(400);
      const printer = await addPrinter({ hotelId: hotel.id, name: 'Rececao', purpose: 'RECEIPT', connection: 'NETWORK', host: '127.0.0.1', port: device.port, copies: 2 }).expect(201);
      expect(printer.body.isDefault).toBe(true);

      const result = await ctx.http().post(`/api/printers/${printer.body.id}/test`).set(auth).expect(200);
      expect(result.body).toMatchObject({ status: 'printed', printer: { name: 'Rececao' } });
      await waitFor(device.jobs, 1);
      const job = device.jobs[0];
      expect(job.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
      expect(job.toString('latin1')).toContain('PAGINA DE TESTE');
      expect(count(job, CUT)).toBe(2);
    } finally {
      await device.close();
    }
  });

  it('envia o pedido para a impressora da categoria e a da cozinha', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const kitchenDevice = await fakePrinter();
    const pastryDevice = await fakePrinter();
    try {
      await addPrinter({ hotelId: hotel.id, name: 'Cozinha', purpose: 'KITCHEN', connection: 'NETWORK', host: '127.0.0.1', port: kitchenDevice.port }).expect(201);
      const pastry = await addPrinter({ hotelId: hotel.id, name: 'Pastelaria', purpose: 'OTHER', connection: 'NETWORK', host: '127.0.0.1', port: pastryDevice.port }).expect(201);
      const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 23 } });
      const food = await ctx.http().post('/api/product-categories').set(auth).send({ hotelId: hotel.id, name: 'Pratos', prepStation: 'KITCHEN' }).expect(201);
      const sweets = await ctx.http().post('/api/product-categories').set(auth).send({ hotelId: hotel.id, name: 'Sobremesas', prepStation: 'KITCHEN', printerId: pastry.body.id }).expect(201);
      const dish = await ctx.prisma.product.create({ data: { hotelId: hotel.id, categoryId: food.body.id, name: 'Bitoque', price: 12, taxRateId: rate.id } });
      const cake = await ctx.prisma.product.create({ data: { hotelId: hotel.id, categoryId: sweets.body.id, name: 'Pastel de nata', price: 1.5, taxRateId: rate.id } });

      const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableLabel: 'Mesa 9' }).expect(201);
      await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: dish.id, quantity: 1, notes: 'sem cebola' }).expect(201);
      await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: cake.id, quantity: 2 }).expect(201);
      const sent = await ctx.http().post(`/api/orders/${order.body.id}/send`).set(auth).expect(200);
      expect(sent.body.targets).toHaveLength(2);

      for (const target of sent.body.targets) {
        const printed = await ctx.http()
          .post('/api/print')
          .set(auth)
          .send({ document: 'ORDER', orderId: order.body.id, station: target.station, printerId: target.printerId, sentAt: sent.body.sentAt })
          .expect(200);
        expect(printed.body.status).toBe('printed');
      }
      await waitFor(kitchenDevice.jobs, 1);
      await waitFor(pastryDevice.jobs, 1);
      expect(kitchenDevice.jobs[0].toString('latin1')).toContain('Bitoque');
      expect(kitchenDevice.jobs[0].toString('latin1')).toContain('sem cebola');
      expect(kitchenDevice.jobs[0].toString('latin1')).not.toContain('Pastel');
      expect(pastryDevice.jobs[0].toString('latin1')).toContain('2 x Pastel de nata');
    } finally {
      await kitchenDevice.close();
      await pastryDevice.close();
    }
  });

  it('impressora sem resposta da erro claro; impressora de navegador devolve o papel', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const offline = await fakePrinter();
    const port = offline.port;
    await offline.close();
    const printer = await addPrinter({ hotelId: hotel.id, name: 'Desligada', purpose: 'RECEIPT', connection: 'NETWORK', host: '127.0.0.1', port }).expect(201);
    const failed = await ctx.http().post(`/api/printers/${printer.body.id}/test`).set(auth).expect(502);
    expect(failed.body.message).toContain('Desligada');

    await ctx.http().patch(`/api/printers/${printer.body.id}`).set(auth).send({ active: false }).expect(200);
    await addPrinter({ hotelId: hotel.id, name: 'Balcao', purpose: 'RECEIPT', connection: 'BROWSER', paperWidth: 'MM58' }).expect(201);
    const guest = await createGuest(ctx.prisma, hotel.id);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(0), checkOut: day(1) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);

    const browser = await ctx.http().post('/api/print').set(auth).send({ document: 'STATEMENT', reservationId: reservation.body.id }).expect(200);
    expect(browser.body).toMatchObject({ status: 'browser', paper: 'MM58', printer: { name: 'Balcao' } });
    const narrow = await ctx.http().get(`/api/print/pdf?document=STATEMENT&reservationId=${reservation.body.id}`).set(auth).responseType('blob').expect(200);
    expect(width(narrow.body)).toBe('164.41');
    const a4 = await ctx.http().get(`/api/print/pdf?document=STATEMENT&reservationId=${reservation.body.id}&paper=A4`).set(auth).responseType('blob').expect(200);
    expect(width(a4.body)).toBe('595.28');
  });

  it('impressora com saida em PDF nao imprime e devolve o papel para pre-visualizar', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const device = await fakePrinter();
    try {
      const printer = await addPrinter({ hotelId: hotel.id, name: 'Talao', purpose: 'RECEIPT', connection: 'NETWORK', host: '127.0.0.1', port: device.port, output: 'PDF' }).expect(201);
      expect(printer.body.output).toBe('PDF');
      const result = await ctx.http().post(`/api/printers/${printer.body.id}/test`).set(auth).expect(200);
      expect(result.body).toMatchObject({ status: 'pdf', paper: 'MM80', printer: { name: 'Talao' } });
      expect(device.jobs).toHaveLength(0);
      const pdf = await ctx.http().get(`/api/print/pdf?document=TEST&printerId=${printer.body.id}&paper=MM80`).set(auth).responseType('blob').expect(200);
      expect(width(pdf.body)).toBe('226.77');

      await ctx.http().patch(`/api/printers/${printer.body.id}`).set(auth).send({ output: 'OUTRA' }).expect(400);
      await ctx.http().patch(`/api/printers/${printer.body.id}`).set(auth).send({ output: 'DIRECT' }).expect(200);
      const direct = await ctx.http().post(`/api/printers/${printer.body.id}/test`).set(auth).expect(200);
      expect(direct.body.status).toBe('printed');
    } finally {
      await device.close();
    }
  });

  it('tipos de pagamento personalizados definem o meio, a referencia e o codigo SAF-T', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { taxId: '500100200', address: 'Rua 1', city: 'Maputo', postalCode: '1100-001' } });
    const defaults = await ctx.http().get(`/api/payment-types?hotelId=${hotel.id}`).set(auth).expect(200);
    expect(defaults.body.map((t: { name: string }) => t.name)).toEqual(['Numerario', 'Cartao', 'Transferencia', 'Pagamento movel', 'Outro']);

    const mpesa = await ctx.http().post('/api/payment-types').set(auth).send({ hotelId: hotel.id, name: 'M-Pesa', kind: 'MOBILE', mechanism: 'MB', requiresReference: true }).expect(201);
    await ctx.http().post('/api/payment-types').set(auth).send({ hotelId: hotel.id, name: 'Errado', kind: 'CARD', mechanism: 'XX' }).expect(400);
    const other = await createHotel(ctx.prisma);
    const foreign = await ctx.prisma.paymentType.create({ data: { hotelId: other.hotel.id, name: 'Alheio', kind: 'CARD' } });

    const guest = await createGuest(ctx.prisma, hotel.id);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(0), checkOut: day(1) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    const pay = (body: object) => ctx.http().post(`/api/reservations/${reservation.body.id}/payments`).set(auth).send({ amount: 10, ...body });

    await pay({ paymentTypeId: mpesa.body.id }).expect(400);
    const paid = await pay({ paymentTypeId: mpesa.body.id, reference: 'MP123' }).expect(201);
    expect(paid.body).toMatchObject({ method: 'MOBILE', paymentTypeId: mpesa.body.id });
    await pay({ paymentTypeId: foreign.id }).expect(400);
    const cash = defaults.body.find((t: { kind: string }) => t.kind === 'CASH');
    expect((await pay({ paymentTypeId: cash.id }).expect(201)).body.cashSessionId).toEqual(expect.any(Number));
    const legacy = await pay({ method: 'CARD' }).expect(201);
    expect(legacy.body.paymentTypeId).toBe(defaults.body.find((t: { kind: string }) => t.kind === 'CARD').id);

    await ctx.http().patch(`/api/payment-types/${mpesa.body.id}`).set(auth).send({ active: false }).expect(200);
    await pay({ paymentTypeId: mpesa.body.id, reference: 'MP124' }).expect(400);
    await ctx.http().patch(`/api/payment-types/${mpesa.body.id}`).set(auth).send({ active: true }).expect(200);

    const invoice = await ctx.http().post(`/api/reservations/${reservation.body.id}/invoices`).set(auth).send({ type: 'INVOICE', customerTaxId: '508000009' }).expect(201);
    await ctx.http().post('/api/receipts').set(auth).send({ hotelId: hotel.id, paymentTypeId: mpesa.body.id, reference: 'MP200', lines: [{ invoiceId: invoice.body.id, amount: 80 }] }).expect(201);
    const xml = (await ctx.http().get(`/api/saft?hotelId=${hotel.id}&from=${day(0)}&to=${day(0)}`).set(auth).expect(200)).text;
    expect(xml).toContain('<PaymentMechanism>MB</PaymentMechanism>');

    const slip = await ctx.http().get(`/api/print/pdf?document=PAYMENT&paymentId=${paid.body.id}`).set(auth).responseType('blob').expect(200);
    expect(width(slip.body)).toBe('226.77');
  });
});

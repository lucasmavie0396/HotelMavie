import { UserRole } from '@prisma/client';
import { REPORTS } from '../src/reports/report-builder.service';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Relatorios', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  async function setup() {
    const { hotel, rooms } = await createHotel(ctx.prisma, { rooms: 3 });
    const admin = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const reception = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email)).auth;
    await ctx.http().post(`/api/hotels/${hotel.id}/logo`).set(admin).send({ data: `data:image/png;base64,${PNG.toString('base64')}` }).expect(201);
    const guest = await ctx.prisma.guest.update({
      where: { id: (await createGuest(ctx.prisma, hotel.id)).id },
      data: { nationality: 'Mocambicana', documentType: 'BI', documentNumber: '110100123456A' },
    });
    const stay = await ctx.http().post('/api/reservations').set(manager).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(0), checkOut: day(2) }).expect(201);
    await ctx.http().post(`/api/reservations/${stay.body.id}/check-in`).set(manager).expect(200);
    await ctx.http().post(`/api/reservations/${stay.body.id}/payments`).set(manager).send({ amount: 100, method: 'CARD' }).expect(201);
    const folio = await ctx.http().get(`/api/reservations/${stay.body.id}/folio`).set(manager).expect(200);
    await ctx.http()
      .post(`/api/reservations/${stay.body.id}/invoices`)
      .set(manager)
      .send({ type: 'INVOICE_RECEIPT', chargeIds: folio.body.charges.map((charge: { id: number }) => charge.id) })
      .expect(201);
    return { hotel, admin, manager, reception };
  }

  it('gera os 12 relatorios em JSON, A4 e 80 mm com os dados do periodo', async () => {
    const { hotel, manager } = await setup();
    const catalog = await ctx.http().get('/api/reports/catalog').set(manager).expect(200);
    expect(catalog.body.map((report: { key: string }) => report.key)).toEqual(REPORTS.map((report) => report.key));

    const params = { hotelId: hotel.id, from: day(-1), to: day(1), date: day(0) };
    for (const { key } of REPORTS) {
      const view = await ctx.http().get(`/api/reports/view/${key}`).query(params).set(manager).expect(200);
      expect(view.body).toMatchObject({ key, hotel: { name: hotel.name } });
      expect(view.body.sections.length).toBeGreaterThan(0);
      for (const paper of ['A4', 'MM80']) {
        const pdf = await ctx.http().get(`/api/reports/view/${key}/pdf`).query({ ...params, paper }).set(manager).buffer(true).expect(200);
        expect(pdf.headers['content-type']).toBe('application/pdf');
        expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      }
    }

    const daily = (await ctx.http().get('/api/reports/view/daily').query(params).set(manager).expect(200)).body;
    const kpis = Object.fromEntries(daily.sections[0].kpis.map((kpi: { label: string; value: string }) => [kpi.label, kpi.value]));
    expect(kpis).toMatchObject({ 'Quartos ocupados': '1 de 3', Chegadas: '1' });
    expect(kpis.Recebido).toContain('100,00');

    const guests = (await ctx.http().get('/api/reports/view/guests').query(params).set(manager).expect(200)).body;
    expect(guests.sections[1].table.rows[0]).toEqual(expect.arrayContaining(['101', 'Mocambicana', 'BI 110100123456A']));

    const sales = (await ctx.http().get('/api/reports/view/sales').query(params).set(manager).expect(200)).body;
    expect(sales.sections[2].table.rows).toHaveLength(1);
    expect(sales.sections[2].table.rows[0][0]).toMatch(/^FR /);

    const vat = (await ctx.http().get('/api/reports/view/vat').query(params).set(manager).expect(200)).body;
    expect(vat.sections[1].table.rows[0][0]).toBe('6%');
  });

  it('a rececao so ve os relatorios operacionais e o relatorio imprime por ESC/POS', async () => {
    const { hotel, reception, manager } = await setup();
    const catalog = await ctx.http().get('/api/reports/catalog').set(reception).expect(200);
    expect(catalog.body.map((report: { key: string }) => report.key).sort()).toEqual(['guests', 'reservations']);
    await ctx.http().get('/api/reports/view/sales').query({ hotelId: hotel.id }).set(reception).expect(403);
    await ctx.http().get('/api/reports/view/guests').query({ hotelId: hotel.id }).set(reception).expect(200);
    await ctx.http().get('/api/reports/view/nao-existe').query({ hotelId: hotel.id }).set(manager).expect(404);

    await ctx.http()
      .post('/api/printers')
      .set(manager)
      .send({ hotelId: hotel.id, name: 'Rececao', purpose: 'RECEIPT', connection: 'LOCAL', localName: 'POS-80', paperWidth: 'MM80' })
      .expect(201);
    const printed = await ctx.http().post('/api/print').set(manager).send({ document: 'REPORT', report: 'daily', hotelId: hotel.id, date: day(0) }).expect(200);
    expect(printed.body.status).toBe('local');
    const bytes = Buffer.from(printed.body.data, 'base64');
    expect(bytes.includes(Buffer.from('RELATORIO DIARIO'))).toBe(true);
    expect(bytes.includes(Buffer.from('CHEGADAS'))).toBe(true);

    const a4 = await ctx.http().get('/api/print/pdf').query({ document: 'REPORT', report: 'sales', hotelId: hotel.id, from: day(-1), to: day(0), paper: 'A4' }).set(manager).buffer(true).expect(200);
    expect((a4.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});

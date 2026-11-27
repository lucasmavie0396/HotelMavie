import { UserRole } from '@prisma/client';
import { localDayStart } from '../src/common/dates';
import { createApp, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Dias no fuso do hotel (documentos entre a meia-noite local e a UTC)', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;
  const previous = process.env.AT_TIMEZONE;

  beforeAll(async () => {
    process.env.AT_TIMEZONE = 'Africa/Maputo';
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(async () => {
    if (previous === undefined) delete process.env.AT_TIMEZONE;
    else process.env.AT_TIMEZONE = previous;
    await ctx.app.close();
  });

  it('uma fatura as 00:30 de Maputo conta no proprio dia nas listas, nos relatorios e no SAF-T', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    await ctx.prisma.hotel.update({
      where: { id: hotel.id },
      data: { taxId: '500100200', legalName: 'Hotel Noturno, Lda', address: 'Avenida 1', city: 'Maputo', postalCode: '1100-001' },
    });
    const iva = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'IVA 16%', rate: 16, atCategory: 'NOR' } });
    const invoice = await ctx.http()
      .post('/api/invoices')
      .set(auth)
      .send({ hotelId: hotel.id, customerName: 'Empresa Noturna', lines: [{ description: 'Servico', quantity: 1, unitPrice: 100, taxRateId: iva.id }] })
      .expect(201);
    const today = day(0);
    const issuedAt = new Date(localDayStart(today).getTime() + 30 * 60 * 1000);
    expect(issuedAt.toISOString().slice(0, 10)).toBe(day(-1));
    await ctx.prisma.invoice.update({ where: { id: invoice.body.id }, data: { issuedAt } });

    const sameDay = await ctx.http().get('/api/invoices').query({ hotelId: hotel.id, from: today, to: today }).set(auth).expect(200);
    expect(sameDay.body.map((row: { id: number }) => row.id)).toEqual([invoice.body.id]);
    const dayBefore = await ctx.http().get('/api/invoices').query({ hotelId: hotel.id, from: day(-1), to: day(-1) }).set(auth).expect(200);
    expect(dayBefore.body).toHaveLength(0);

    const sales = (await ctx.http().get('/api/reports/view/sales').query({ hotelId: hotel.id, from: today, to: today }).set(auth).expect(200)).body;
    const rows = sales.sections.flatMap((section: { table?: { rows: string[][] } }) => section.table?.rows ?? []);
    const row = rows.find((cells: string[]) => cells.includes(invoice.body.fullNumber));
    expect(row).toBeDefined();
    expect(row).toContain(today.split('-').reverse().join('/'));

    const saft = await ctx.http().get('/api/saft').query({ hotelId: hotel.id, from: today, to: today }).set(auth).expect(200);
    expect(saft.text).toContain(invoice.body.fullNumber);
  });
});

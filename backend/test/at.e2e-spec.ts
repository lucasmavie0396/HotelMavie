import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Preparacao AT', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function fiscalHotel() {
    const setup = await createHotel(ctx.prisma);
    await ctx.prisma.hotel.update({
      where: { id: setup.hotel.id },
      data: { taxId: '500100200', legalName: 'Mavie & Filhos, Lda', address: 'Rua <Principal> 1', city: 'Lisboa', postalCode: '1000-001' },
    });
    return setup;
  }

  async function invoiceFor(hotelId: number, roomId: number, extra?: { taxRateId: number; unitPrice: number }) {
    const guest = await createGuest(ctx.prisma, hotelId);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId, checkIn: day(0), checkOut: day(1) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    if (extra) {
      await ctx.http().post(`/api/reservations/${reservation.body.id}/charges`).set(auth).send({ description: 'Taxa turistica', quantity: 1, ...extra }).expect(201);
    }
    return reservation.body.id as number;
  }

  it('taxas de 0% exigem motivo e codigo de isencao; Isento so a 0%', async () => {
    const { hotel } = await fiscalHotel();
    await ctx.http().post('/api/tax-rates').set(auth).send({ hotelId: hotel.id, name: 'Isento', rate: 0, exemptionReason: 'Artigo 9.o' }).expect(400);
    await ctx.http().post('/api/tax-rates').set(auth).send({ hotelId: hotel.id, name: 'Isento', rate: 0, exemptionReason: 'Artigo 9.o', exemptionCode: 'X1' }).expect(400);
    const exempt = await ctx.http().post('/api/tax-rates').set(auth).send({ hotelId: hotel.id, name: 'Isento', rate: 0, exemptionReason: 'Artigo 9.o do CIVA', exemptionCode: 'M07' }).expect(201);
    expect(exempt.body.atCategory).toBe('ISE');
    await ctx.http().post('/api/tax-rates').set(auth).send({ hotelId: hotel.id, name: 'Errada', rate: 23, atCategory: 'ISE' }).expect(400);
    const normal = await ctx.http().post('/api/tax-rates').set(auth).send({ hotelId: hotel.id, name: 'Normal', rate: 23 }).expect(201);
    expect(normal.body).toMatchObject({ atCategory: 'NOR', exemptionCode: null });
    await ctx.http().patch(`/api/tax-rates/${normal.body.id}`).set(auth).send({ atCategory: 'ISE' }).expect(400);
  });

  it('recusa faturar lancamentos sem taxa de IVA', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma, { accommodationRate: null });
    const id = await invoiceFor(hotel.id, rooms[0].id);
    const response = await ctx.http().post(`/api/reservations/${id}/invoices`).set(auth).send({}).expect(400);
    expect(response.body.message).toContain('sem taxa de IVA');
  });

  it('o ATCUD so se regista antes do primeiro documento e aparece nas faturas', async () => {
    const { hotel, rooms } = await fiscalHotel();
    const series = await ctx.http().post('/api/invoice-series').set(auth).send({ hotelId: hotel.id, type: 'INVOICE' }).expect(201);
    await ctx.http().patch(`/api/invoice-series/${series.body.id}`).set(auth).send({ atValidationCode: 'abc' }).expect(400);
    await ctx.http().patch(`/api/invoice-series/${series.body.id}`).set(auth).send({ atValidationCode: 'AAJFJ4VC' }).expect(200);

    const id = await invoiceFor(hotel.id, rooms[0].id);
    const invoice = await ctx.http().post(`/api/reservations/${id}/invoices`).set(auth).send({ type: 'INVOICE' }).expect(201);
    expect(invoice.body.atcud).toBe('AAJFJ4VC-1');

    await ctx.http().patch(`/api/invoice-series/${series.body.id}`).set(auth).send({ atValidationCode: 'BBBBBBBB' }).expect(409);
  });

  it('exporta SAF-T com cabecalho, clientes, impostos, documentos e totais coerentes', async () => {
    const { hotel, rooms } = await fiscalHotel();
    const exempt = await ctx.prisma.taxRate.create({
      data: { hotelId: hotel.id, name: 'Isento', rate: 0, atCategory: 'ISE', exemptionReason: 'Artigo 9.o do CIVA', exemptionCode: 'M07' },
    });
    const first = await invoiceFor(hotel.id, rooms[0].id, { taxRateId: exempt.id, unitPrice: 2 });
    const ft = await ctx.http().post(`/api/reservations/${first}/invoices`).set(auth).send({ type: 'INVOICE', customerTaxId: '123456789' }).expect(201);
    const second = await invoiceFor(hotel.id, rooms[1].id);
    await ctx.http().post(`/api/reservations/${second}/invoices`).set(auth).send({ type: 'INVOICE_RECEIPT' }).expect(201);
    await ctx.http().post(`/api/invoices/${ft.body.id}/credit-note`).set(auth).send({ reason: 'Erro no NIF' }).expect(201);

    const response = await ctx.http().get(`/api/saft?hotelId=${hotel.id}&from=${day(0)}&to=${day(0)}`).set(auth).expect(200);
    expect(response.headers['content-type']).toContain('application/xml');
    const xml = response.text;

    expect(xml).toContain('<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01">');
    expect(xml).toContain('<TaxRegistrationNumber>500100200</TaxRegistrationNumber>');
    expect(xml).toContain('<CompanyName>Mavie &amp; Filhos, Lda</CompanyName>');
    expect(xml).toContain('<AddressDetail>Rua &lt;Principal&gt; 1</AddressDetail>');
    expect(xml).toContain('<NumberOfEntries>3</NumberOfEntries>');
    expect(xml).toContain('<CustomerID>CF</CustomerID>');
    expect(xml).toContain('<CustomerTaxID>123456789</CustomerTaxID>');
    expect(xml).toMatch(/<TaxCode>RED<\/TaxCode><Description>Taxa reduzida<\/Description><TaxPercentage>6.00<\/TaxPercentage>/);
    expect(xml).toContain('<TaxExemptionReason>Artigo 9.o do CIVA</TaxExemptionReason><TaxExemptionCode>M07</TaxExemptionCode>');
    expect(xml).toMatch(/<InvoiceNo>NC \d{4}\/1<\/InvoiceNo>/);
    expect(xml).toMatch(/<References><Reference>FT \d{4}\/1<\/Reference><Reason>Erro no NIF<\/Reason><\/References>/);
    expect(xml).toContain('<ProductCode>ALOJ</ProductCode>');

    const credit = xml.match(/<TotalCredit>([\d.]+)<\/TotalCredit>/)![1];
    const debit = xml.match(/<TotalDebit>([\d.]+)<\/TotalDebit>/)![1];
    expect(Number(credit)).toBeCloseTo(75.47 + 2 + 75.47, 2);
    expect(Number(debit)).toBeCloseTo(77.47, 2);
    expect((xml.match(/<Invoice>/g) ?? []).length).toBe(3);
  });

  it('o PDF tem QR code e o SAF-T exige NIF do hotel', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const id = await invoiceFor(hotel.id, rooms[0].id);
    const invoice = await ctx.http().post(`/api/reservations/${id}/invoices`).set(auth).send({ type: 'INVOICE' }).expect(201);
    const pdf = await ctx.http().get(`/api/invoices/${invoice.body.id}/pdf`).set(auth).responseType('blob').expect(200);
    expect(pdf.body.length).toBeGreaterThan(3000);
    expect((pdf.body.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
    await ctx.http().get(`/api/saft?hotelId=${hotel.id}&from=${day(0)}&to=${day(0)}`).set(auth).expect(400);
  });
});

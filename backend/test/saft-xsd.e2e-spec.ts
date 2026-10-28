import { UserRole } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateXML } from 'xmllint-wasm';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

const OFFICIAL_XSD = readFileSync(resolve(__dirname, 'fixtures', 'saftpt1.04_01.xsd'), 'latin1');
const ASSERT = /<xs:assert\s+test="[^"]*"\s*\/>/g;

const XSD_1_0 = OFFICIAL_XSD.replace('encoding="Windows-1252"', 'encoding="UTF-8"')
  .replace(ASSERT, '')
  .replace(/<xs:all>/g, '<xs:sequence>')
  .replace(/<\/xs:all>/g, '</xs:sequence>');

function blocks(xml: string, tag: string) {
  return xml.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g')) ?? [];
}

function tagValue(xml: string, tag: string) {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];
}

function officialAsserts(xml: string) {
  const errors: string[] = [];
  for (const invoice of blocks(xml, 'Invoice')) {
    const number = tagValue(invoice, 'InvoiceNo');
    for (const line of blocks(invoice, 'Line')) {
      const percentage = Number(tagValue(line, 'TaxPercentage'));
      const reason = line.includes('<TaxExemptionReason>');
      const code = line.includes('<TaxExemptionCode>');
      if (percentage !== 0 && reason) errors.push(`${number}: taxa ${percentage} com motivo de isencao`);
      if (percentage === 0 && !reason) errors.push(`${number}: taxa 0 sem motivo de isencao`);
      if (reason !== code) errors.push(`${number}: motivo e codigo de isencao tem de existir juntos`);
    }
  }
  for (const payment of blocks(xml, 'Payment')) {
    const type = tagValue(payment, 'PaymentType');
    if (type === 'RC' && !payment.includes('<Tax>')) errors.push(`${tagValue(payment, 'PaymentRefNo')}: recibo RC sem imposto`);
    if (type !== 'RG' && type !== 'RC') errors.push(`${tagValue(payment, 'PaymentRefNo')}: tipo de pagamento ${type}`);
  }
  return errors;
}

async function validate(xml: string) {
  const result = await validateXML({
    xml: [{ fileName: 'saft.xml', contents: xml }],
    schema: [{ fileName: 'saftpt1.04_01.xsd', contents: XSD_1_0 }],
  });
  return [...result.errors.map((error) => error.rawMessage ?? error.message), ...officialAsserts(xml)];
}

describe('XSD oficial', () => {
  it('so contem construcoes XSD 1.1 conhecidas', () => {
    expect(OFFICIAL_XSD.match(ASSERT)).toHaveLength(19);
    expect(OFFICIAL_XSD.match(/<xs:all>/g)).toHaveLength(1);
  });
});

describe('SAF-T (PT) contra o XSD oficial 1.04_01', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function stay(hotelId: number, roomId: number) {
    const guest = await createGuest(ctx.prisma, hotelId);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId, checkIn: day(0), checkOut: day(1) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    return reservation.body.id as number;
  }

  it('um ficheiro com todos os tipos de documento e valido', async () => {
    const { hotel, rooms } = await createHotel(ctx.prisma, { rooms: 3 });
    await ctx.prisma.hotel.update({
      where: { id: hotel.id },
      data: { taxId: '500100200', legalName: 'Mavie & Filhos, Lda', address: 'Rua da Prata, 10', city: 'Lisboa', postalCode: '1100-001' },
    });
    const normal = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 23, atCategory: 'NOR' } });
    const exempt = await ctx.prisma.taxRate.create({
      data: { hotelId: hotel.id, name: 'Isento', rate: 0, atCategory: 'ISE', exemptionReason: 'Artigo 9.o do CIVA', exemptionCode: 'M07' },
    });

    const first = await stay(hotel.id, rooms[0].id);
    await ctx.http().post(`/api/reservations/${first}/charges`).set(auth).send({ description: 'Minibar <agua>', quantity: 2, unitPrice: 1.5, taxRateId: normal.id }).expect(201);
    await ctx.http().post(`/api/reservations/${first}/charges`).set(auth).send({ description: 'Taxa turistica', quantity: 1, unitPrice: 2, taxRateId: exempt.id }).expect(201);
    const ft = await ctx.http().post(`/api/reservations/${first}/invoices`).set(auth).send({ type: 'INVOICE', customerName: 'Empresa & Co', customerTaxId: '508000001' }).expect(201);

    const second = await stay(hotel.id, rooms[1].id);
    await ctx.http().post(`/api/reservations/${second}/invoices`).set(auth).send({ type: 'INVOICE_RECEIPT' }).expect(201);

    const third = await stay(hotel.id, rooms[2].id);
    const toCredit = await ctx.http().post(`/api/reservations/${third}/invoices`).set(auth).send({ type: 'INVOICE', customerTaxId: '508000002' }).expect(201);
    await ctx.http().post(`/api/invoices/${toCredit.body.id}/credit-note`).set(auth).send({ reason: 'NIF errado' }).expect(201);

    await ctx.http().post('/api/receipts').set(auth).send({ hotelId: hotel.id, method: 'TRANSFER', reference: 'TRF 123', lines: [{ invoiceId: ft.body.id, amount: 50 }] }).expect(201);
    const cancelled = await ctx.http().post('/api/receipts').set(auth).send({ hotelId: hotel.id, method: 'CARD', lines: [{ invoiceId: ft.body.id, amount: 10 }] }).expect(201);
    await ctx.http().post(`/api/receipts/${cancelled.body.id}/cancel`).set(auth).send({ reason: 'Valor errado' }).expect(200);

    const xml = (await ctx.http().get(`/api/saft?hotelId=${hotel.id}&from=${day(0)}&to=${day(0)}`).set(auth).expect(200)).text;
    expect(await validate(xml)).toEqual([]);
    expect((xml.match(/<Invoice>/g) ?? []).length).toBe(4);
    expect((xml.match(/<Payment>/g) ?? []).length).toBe(2);
  });

  it('exige morada fiscal completa', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { taxId: '500100200', city: 'Porto', address: 'Rua 1', postalCode: '4000' } });
    await ctx.http().get(`/api/saft?hotelId=${hotel.id}&from=${day(0)}&to=${day(0)}`).set(auth).expect(400);
  });

  it('um ficheiro sem documentos tambem e valido', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { taxId: '500100200', city: 'Porto', postalCode: '4000-001', address: 'Rua 1' } });
    const xml = (await ctx.http().get(`/api/saft?hotelId=${hotel.id}&from=${day(0)}&to=${day(0)}`).set(auth).expect(200)).text;
    expect(await validate(xml)).toEqual([]);
  });
});

import { UserRole } from '@prisma/client';
import ExcelJS from 'exceljs';
import { createApp, createHotel, createUser, login, TestContext } from './helpers';

describe('Produtos em Excel', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    auth = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
  });

  afterAll(() => ctx.app.close());

  const binary = (res: NodeJS.ReadableStream, done: (error: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  };
  const parser = binary as unknown as Parameters<ReturnType<ReturnType<TestContext['http']>['get']>['parse']>[0];

  async function file(rows: (string | number)[][]) {
    const response = await ctx.http().get('/api/products/import-template.xlsx').set(auth).buffer(true).parse(parser).expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Produtos')!;
    sheet.spliceRows(2, sheet.rowCount);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  }

  it('verifica o ficheiro inteiro, so importa sem erros, cria categorias e stock e atualiza pelo codigo', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 16 } });
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    const existing = await ctx.prisma.product.create({ data: { hotelId: hotel.id, sku: 'B1', name: 'Cerveja', price: 2, trackStock: true } });

    const bad = await file([
      ['', '', 'Bebidas', 'un', 50],
      ['A1', 'Agua', 'Bebidas', 'un', 'abc', '', 99],
      ['A1', 'Agua 2', '', '', 10],
    ]);
    const check = await ctx.http().post('/api/products/import/check').set(auth).send({ hotelId: hotel.id, file: bad }).expect(200);
    expect(check.body).toMatchObject({ total: 3, withErrors: 3 });
    expect(check.body.rows[0].errors).toContain('Indique o nome');
    expect(check.body.rows[1].errors.join(' ')).toContain('invalido');
    expect(check.body.rows[1].errors.join(' ')).toContain('taxa de IVA de 99%');
    expect(check.body.rows[2].errors).toContain('Codigo A1 repetido no ficheiro');
    await ctx.http().post('/api/products/import').set(auth).send({ hotelId: hotel.id, file: bad }).expect(400);
    expect(await ctx.prisma.product.count({ where: { hotelId: hotel.id } })).toBe(1);

    const good = await file([
      ['', 'Agua 0,5 L', 'Bebidas', 'un', '50,5', 20, 16, 'Sim', 'Nao', 'Sim', 24, 48, '', 'Sim'],
      ['B1', 'Cerveja 2M', 'Bebidas', 'garrafa', 75, '', '', '', '', '', 12],
    ]);
    const ok = await ctx.http().post('/api/products/import/check').set(auth).send({ hotelId: hotel.id, file: good }).expect(200);
    expect(ok.body).toMatchObject({ total: 2, withErrors: 0, toCreate: 1, toUpdate: 1, newCategories: ['Bebidas'] });
    const applied = await ctx.http().post('/api/products/import').set(auth).send({ hotelId: hotel.id, file: good }).expect(200);
    expect(applied.body).toMatchObject({ created: 1, updated: 1, newCategories: ['Bebidas'] });

    const water = await ctx.prisma.product.findFirstOrThrow({ where: { hotelId: hotel.id, name: 'Agua 0,5 L' }, include: { category: true, taxRate: true } });
    expect(water).toMatchObject({ unit: 'un', sellable: true, roomService: false, trackStock: true });
    expect(Number(water.price)).toBe(50.5);
    expect(water.category?.name).toBe('Bebidas');
    expect(Number(water.taxRate?.rate)).toBe(16);
    const level = await ctx.prisma.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: main.body.id, productId: water.id } } });
    expect(Number(level.quantity)).toBe(48);
    const beer = await ctx.prisma.product.findUniqueOrThrow({ where: { id: existing.id } });
    expect(beer).toMatchObject({ name: 'Cerveja 2M', unit: 'garrafa', trackStock: true });
    expect(Number(beer.price)).toBe(75);

    const exported = await ctx.http().get('/api/products/export.xlsx').query({ hotelId: hotel.id }).set(auth).buffer(true).parse(parser).expect(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Produtos')!;
    expect(sheet.rowCount).toBe(3);
    const names = [2, 3].map((row) => String(sheet.getRow(row).getCell(2).value));
    expect(names.sort()).toEqual(['Agua 0,5 L', 'Cerveja 2M']);

    const reception = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const receptionAuth = (await login(ctx, reception.email)).auth;
    await ctx.http().post('/api/products/import').set(receptionAuth).send({ hotelId: hotel.id, file: good }).expect(403);
  });
});

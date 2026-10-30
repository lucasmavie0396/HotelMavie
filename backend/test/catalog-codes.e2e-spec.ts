import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, login, TestContext } from './helpers';

describe('Catalogo: codigos e categorias', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('gera o codigo do produto automaticamente a partir de 01', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const create = (body: Record<string, unknown>) => ctx.http().post('/api/products').set(manager).send({ hotelId: hotel.id, price: 10, ...body });

    expect((await ctx.http().get(`/api/products/next-sku?hotelId=${hotel.id}`).set(manager).expect(200)).body.sku).toBe('01');
    expect((await create({ name: 'Agua' }).expect(201)).body.sku).toBe('01');
    expect((await create({ name: 'Cafe', sku: '' }).expect(201)).body.sku).toBe('02');
    expect((await create({ name: 'Vinho', sku: 'VIN-A' }).expect(201)).body.sku).toBe('VIN-A');
    expect((await create({ name: 'Cerveja', sku: '15' }).expect(201)).body.sku).toBe('15');
    expect((await create({ name: 'Sumo' }).expect(201)).body.sku).toBe('16');
    await create({ name: 'Repetido', sku: '01' }).expect(409);

    const results = await Promise.all(['A', 'B', 'C'].map((name) => create({ name: `Simultaneo ${name}` })));
    const codes = results.map((result) => result.body.sku).sort();
    expect(results.every((result) => result.status === 201)).toBe(true);
    expect(codes).toEqual(['17', '18', '19']);

    const other = await createHotel(ctx.prisma);
    const otherManager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, other.hotel.id)).email)).auth;
    expect((await ctx.http().post('/api/products').set(otherManager).send({ hotelId: other.hotel.id, name: 'Agua' }).expect(201)).body.sku).toBe('01');
  });

  it('edita a categoria e muda a impressora, so com impressoras do proprio hotel', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const reception = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email)).auth;
    const kitchen = await ctx.http().post('/api/printers').set(manager).send({ hotelId: hotel.id, name: 'Cozinha', purpose: 'KITCHEN' }).expect(201);
    const bar = await ctx.http().post('/api/printers').set(manager).send({ hotelId: hotel.id, name: 'Bar', purpose: 'BAR' }).expect(201);
    const category = await ctx.http().post('/api/product-categories').set(manager).send({ hotelId: hotel.id, name: 'Bebidas', prepStation: 'KITCHEN', printerId: kitchen.body.id }).expect(201);

    const updated = await ctx.http()
      .patch(`/api/product-categories/${category.body.id}`)
      .set(manager)
      .send({ name: 'Bebidas frias', outlet: 'BAR', prepStation: 'BAR', printerId: bar.body.id })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Bebidas frias', outlet: 'BAR', prepStation: 'BAR', printerId: bar.body.id });

    const cleared = await ctx.http().patch(`/api/product-categories/${category.body.id}`).set(manager).send({ printerId: null }).expect(200);
    expect(cleared.body.printerId).toBeNull();

    const other = await createHotel(ctx.prisma);
    const foreign = await ctx.prisma.printer.create({ data: { hotelId: other.hotel.id, name: 'Outra', purpose: 'BAR' } });
    await ctx.http().patch(`/api/product-categories/${category.body.id}`).set(manager).send({ printerId: foreign.id }).expect(400);
    await ctx.http().patch(`/api/product-categories/${category.body.id}`).set(reception).send({ name: 'X' }).expect(403);
  });
});

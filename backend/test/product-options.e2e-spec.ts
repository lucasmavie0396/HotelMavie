import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, login, TestContext } from './helpers';

describe('Acompanhamentos e opcoes de produto', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    auth = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
  });

  afterAll(() => ctx.app.close());

  it('exige a escolha obrigatoria, soma o preco das opcoes, mantem-nas ao dividir e abate o ingrediente', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { allowNegativeStock: false } });
    const warehouse = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 16 } });
    const steak = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Bife', price: 500, taxRateId: rate.id } });
    const potato = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Batata', unit: 'kg', price: 0, trackStock: true, sellable: false } });
    await ctx.prisma.stockLevel.create({ data: { warehouseId: warehouse.body.id, productId: potato.id, quantity: 10 } });
    const other = await createHotel(ctx.prisma);
    const foreign = await ctx.prisma.product.create({ data: { hotelId: other.hotel.id, name: 'Alheio', trackStock: true } });

    const groups = (ingredientId: number) => ({
      groups: [
        { name: 'Acompanhamento', required: true, maxChoices: 1, options: [{ name: 'Batata frita', ingredientId, quantity: 0.25 }, { name: 'Arroz' }, { name: 'Salada', priceDelta: 50 }] },
        { name: 'Ponto', required: false, maxChoices: 1, options: [{ name: 'Mal passado' }, { name: 'Bem passado' }] },
      ],
    });
    await ctx.http().put(`/api/products/${steak.id}/options`).set(auth).send(groups(foreign.id)).expect(400);
    const saved = await ctx.http().put(`/api/products/${steak.id}/options`).set(auth).send(groups(potato.id)).expect(200);
    expect(saved.body).toHaveLength(2);
    const [sides, cooking] = saved.body;
    const option = (group: { options: { id: number; name: string }[] }, name: string) => group.options.find((entry) => entry.name === name)!.id;

    const list = await ctx.http().get('/api/products').query({ hotelId: hotel.id }).set(auth).expect(200);
    expect(list.body.find((product: { id: number }) => product.id === steak.id).optionGroups).toHaveLength(2);

    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'RESTAURANT' }).expect(201);
    const add = (options?: number[], quantity = 2) => ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: steak.id, quantity, options });
    const missing = await add().expect(400);
    expect(missing.body.message).toContain('acompanhamento');
    await add([option(sides, 'Arroz'), option(sides, 'Salada')]).expect(400);
    await add([999999]).expect(400);
    const added = await add([option(sides, 'Batata frita'), option(cooking, 'Bem passado')]).expect(201);
    const line = added.body.items[0];
    expect(line).toMatchObject({ description: 'Bife (Batata frita, Bem passado)', unitPrice: '500', total: '1000' });
    expect(line.options.map((entry: { name: string }) => entry.name)).toEqual(['Batata frita', 'Bem passado']);
    const salad = await add([option(sides, 'Salada')], 1).expect(201);
    expect(salad.body.items[1]).toMatchObject({ unitPrice: '550', total: '550' });

    const split = await ctx.http().post(`/api/orders/${order.body.id}/move-items`).set(auth).send({ items: [{ itemId: line.id, quantity: 1 }] }).expect(200);
    expect(split.body.to.items[0].options).toHaveLength(2);

    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 1050 }] }).expect(200);
    await ctx.http().post(`/api/orders/${split.body.to.id}/close`).set(auth).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 500 }] }).expect(200);
    const level = await ctx.prisma.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: warehouse.body.id, productId: potato.id } } });
    expect(level.quantity.toString()).toBe('9.5');
  });
});

import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, login, TestContext } from './helpers';

describe('Receitas', () => {
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
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Restauracao', rate: 13 } });
    const warehouse = await ctx.prisma.warehouse.create({ data: { hotelId: hotel.id, name: 'Cozinha', isDefault: true } });
    const ingredient = (name: string, cost: number, unit: string) =>
      ctx.prisma.product.create({ data: { hotelId: hotel.id, name, cost, unit, trackStock: true, sellable: false } });
    const steak = await ingredient('Bife', 4, 'kg');
    const egg = await ingredient('Ovo', 0.2, 'un');
    const potato = await ingredient('Batata', 1, 'kg');
    for (const product of [steak, egg, potato]) {
      await ctx.prisma.stockLevel.create({ data: { warehouseId: warehouse.id, productId: product.id, quantity: 10 } });
    }
    const dish = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Bitoque', price: 11.3, taxRateId: rate.id } });
    return { hotel, warehouse, steak, egg, potato, dish };
  }

  const level = async (warehouseId: number, productId: number) =>
    Number((await ctx.prisma.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId } } })).quantity);

  it('calcula custo e margem do prato', async () => {
    const { steak, egg, potato, dish } = await setup();
    const recipe = await ctx.http()
      .put(`/api/products/${dish.id}/recipe`)
      .set(auth)
      .send({ items: [{ ingredientId: steak.id, quantity: 0.25 }, { ingredientId: egg.id, quantity: 1 }, { ingredientId: potato.id, quantity: 0.3 }] })
      .expect(200);
    expect(recipe.body).toMatchObject({ cost: '1.5', netPrice: '10', margin: '8.5', marginPercent: 85 });
    expect(recipe.body.items).toHaveLength(3);
  });

  it('vender o prato desconta os ingredientes e nao o prato', async () => {
    const { hotel, warehouse, steak, egg, potato, dish } = await setup();
    await ctx.http().put(`/api/products/${dish.id}/recipe`).set(auth)
      .send({ items: [{ ingredientId: steak.id, quantity: 0.25 }, { ingredientId: egg.id, quantity: 1 }, { ingredientId: potato.id, quantity: 0.3 }] })
      .expect(200);

    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'RESTAURANT' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: dish.id, quantity: 2 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 22.6 }] }).expect(200);

    expect(await level(warehouse.id, steak.id)).toBeCloseTo(9.5, 3);
    expect(await level(warehouse.id, egg.id)).toBe(8);
    expect(await level(warehouse.id, potato.id)).toBeCloseTo(9.4, 3);
    const movements = await ctx.prisma.stockMovement.findMany({ where: { orderId: order.body.id } });
    expect(movements).toHaveLength(3);
    expect(movements[0].reason).toContain('Bitoque');
  });

  it('rejeita receitas invalidas', async () => {
    const { hotel, steak, dish } = await setup();
    const noStock = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Sal', trackStock: false } });
    const other = await createHotel(ctx.prisma);
    const foreign = await ctx.prisma.product.create({ data: { hotelId: other.hotel.id, name: 'Alheio', trackStock: true } });
    const put = (productId: number, items: object[]) => ctx.http().put(`/api/products/${productId}/recipe`).set(auth).send({ items });

    await put(dish.id, [{ ingredientId: noStock.id, quantity: 1 }]).expect(400);
    await put(dish.id, [{ ingredientId: foreign.id, quantity: 1 }]).expect(400);
    await put(dish.id, [{ ingredientId: dish.id, quantity: 1 }]).expect(400);
    await put(dish.id, [{ ingredientId: steak.id, quantity: 1 }, { ingredientId: steak.id, quantity: 2 }]).expect(400);
    await put(steak.id, [{ ingredientId: dish.id, quantity: 1 }]).expect(400);

    await put(dish.id, [{ ingredientId: steak.id, quantity: 0.2 }]).expect(200);
    await ctx.http().patch(`/api/products/${dish.id}`).set(auth).send({ trackStock: true }).expect(400);
    await ctx.http().patch(`/api/products/${steak.id}`).set(auth).send({ trackStock: false }).expect(400);
    await put(dish.id, []).expect(200);
  });

  it('o relatorio mostra o custo das vendas de restauracao', async () => {
    const { hotel, steak, dish } = await setup();
    await ctx.http().put(`/api/products/${dish.id}/recipe`).set(auth).send({ items: [{ ingredientId: steak.id, quantity: 0.5 }] }).expect(200);
    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'RESTAURANT' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: dish.id, quantity: 1 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 11.3 }] }).expect(200);

    const today = new Date().toISOString().slice(0, 10);
    const report = await ctx.http().get(`/api/reports/summary?hotelId=${hotel.id}&from=${today}&to=${today}`).set(auth).expect(200);
    expect(report.body.foodAndBeverage).toMatchObject({ revenue: '11.3', costOfSales: '2', costPercent: 17.7 });
  });
});

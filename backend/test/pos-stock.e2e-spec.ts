import { UserRole } from '@prisma/client';
import { createApp, createGuest, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Restaurante/bar, stocks e compras', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function setup() {
    const { hotel, rooms } = await createHotel(ctx.prisma);
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 23 } });
    const beer = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Cerveja', price: 2.5, taxRateId: rate.id, trackStock: true } });
    const dish = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Prato do dia', price: 10, taxRateId: rate.id } });
    const supplier = await ctx.prisma.supplier.create({ data: { hotelId: hotel.id, name: 'Fornecedor' } });
    return { hotel, rooms, beer, dish, supplier };
  }

  const stockOf = async (warehouseId: number, productId: number) =>
    Number((await ctx.prisma.stockLevel.findUnique({ where: { warehouseId_productId: { warehouseId, productId } } }))?.quantity ?? 0);

  async function receive(supplierId: number, warehouseId: number, productId: number, quantity: number, unitCost: number) {
    const purchase = await ctx.http().post('/api/purchases').set(auth).send({ supplierId, warehouseId, items: [{ productId, quantity, unitCost }] }).expect(201);
    return ctx.http().post(`/api/purchases/${purchase.body.id}/receive`).set(auth).expect(200);
  }

  it('compras dao entrada em stock com custo medio ponderado e so uma vez', async () => {
    const { hotel, beer, supplier } = await setup();
    const warehouse = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    expect(warehouse.body.isDefault).toBe(true);

    const first = await receive(supplier.id, warehouse.body.id, beer.id, 48, 0.8);
    await receive(supplier.id, warehouse.body.id, beer.id, 24, 1.1);
    await ctx.http().post(`/api/purchases/${first.body.id}/receive`).set(auth).expect(409);

    expect(await stockOf(warehouse.body.id, beer.id)).toBe(72);
    expect(Number((await ctx.prisma.product.findUniqueOrThrow({ where: { id: beer.id } })).cost)).toBeCloseTo(0.9, 4);
  });

  it('venda paga emite fatura-recibo e desconta stock; pagamento errado nao deixa rasto', async () => {
    const { hotel, beer, dish, supplier } = await setup();
    const warehouse = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    await receive(supplier.id, warehouse.body.id, beer.id, 10, 1);

    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'BAR', tableLabel: 'Balcao' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: beer.id, quantity: 4 }).expect(201);
    const withDish = await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: dish.id, quantity: 1 }).expect(201);
    expect(withDish.body.total).toBe('20');

    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 15 }] }).expect(400);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.body.id } })).status).toBe('OPEN');
    expect(await stockOf(warehouse.body.id, beer.id)).toBe(10);
    expect(await ctx.prisma.invoice.count({ where: { hotelId: hotel.id } })).toBe(0);
    expect(await ctx.prisma.charge.count({ where: { hotelId: hotel.id } })).toBe(0);

    const closed = await ctx.http()
      .post(`/api/orders/${order.body.id}/close`)
      .set(auth)
      .send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 12 }, { method: 'MOBILE', amount: 8 }] })
      .expect(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(await stockOf(warehouse.body.id, beer.id)).toBe(6);
    const invoice = await ctx.prisma.invoice.findFirstOrThrow({ where: { hotelId: hotel.id } });
    expect(invoice).toMatchObject({ type: 'INVOICE_RECEIPT' });
    expect(invoice.grossTotal.toString()).toBe('20');
    expect(await ctx.prisma.payment.count({ where: { orderId: order.body.id, invoiceId: invoice.id } })).toBe(2);

    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: beer.id, quantity: 1 }).expect(409);
  });

  it('lancar no quarto exige hospede em casa e vai para a conta', async () => {
    const { hotel, rooms, dish } = await setup();
    const guest = await createGuest(ctx.prisma, hotel.id);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: day(0), checkOut: day(1) }).expect(201);

    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'RESTAURANT' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: dish.id, quantity: 2 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'ROOM', reservationId: reservation.body.id }).expect(400);

    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'ROOM', reservationId: reservation.body.id }).expect(200);
    const folio = await ctx.http().get(`/api/reservations/${reservation.body.id}/folio`).set(auth).expect(200);
    expect(folio.body.charges.find((c: { type: string }) => c.type === 'RESTAURANT').total).toBe('20');
  });

  it('sem armazem principal a venda de produto com stock falha sem fechar o pedido', async () => {
    const { hotel, beer } = await setup();
    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'BAR' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: beer.id, quantity: 1 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 2.5 }] }).expect(409);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.body.id } })).status).toBe('OPEN');
    expect(await ctx.prisma.invoice.count({ where: { hotelId: hotel.id } })).toBe(0);
  });

  it('transferencias e inventario mantem os saldos coerentes', async () => {
    const { hotel, beer, supplier } = await setup();
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    const bar = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Bar' }).expect(201);
    await receive(supplier.id, main.body.id, beer.id, 20, 1);

    await ctx.http().post(`/api/warehouses/${main.body.id}/transfer`).set(auth).send({ productId: beer.id, toWarehouseId: bar.body.id, quantity: 8 }).expect(201);
    await ctx.http().post(`/api/warehouses/${bar.body.id}/transfer`).set(auth).send({ productId: beer.id, toWarehouseId: main.body.id, quantity: 9 }).expect(409);
    expect(await stockOf(main.body.id, beer.id)).toBe(12);
    expect(await stockOf(bar.body.id, beer.id)).toBe(8);

    const adjust = await ctx.http().post(`/api/warehouses/${main.body.id}/adjust`).set(auth).send({ productId: beer.id, countedQuantity: 10 }).expect(201);
    expect(adjust.body).toMatchObject({ quantity: '-2', balance: '10' });
    await ctx.http().post(`/api/warehouses/${bar.body.id}/waste`).set(auth).send({ productId: beer.id, quantity: 1, reason: 'Partida' }).expect(201);
    expect(await stockOf(bar.body.id, beer.id)).toBe(7);

    const other = await createHotel(ctx.prisma);
    const foreign = await ctx.prisma.product.create({ data: { hotelId: other.hotel.id, name: 'Alheio', trackStock: true } });
    await ctx.http().post(`/api/warehouses/${main.body.id}/adjust`).set(auth).send({ productId: foreign.id, countedQuantity: 5 }).expect(404);
  });

  it('documentos de stock agrupam linhas e so mexem no stock ao lancar', async () => {
    const { hotel, beer, supplier } = await setup();
    const water = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Agua', price: 1, trackStock: true } });
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    const bar = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Bar' }).expect(201);
    await receive(supplier.id, main.body.id, beer.id, 20, 1);
    await receive(supplier.id, main.body.id, water.id, 10, 0.3);

    const transfer = await ctx.http()
      .post('/api/stock-documents')
      .set(auth)
      .send({ type: 'TRANSFER', warehouseId: main.body.id, toWarehouseId: bar.body.id, items: [{ productId: beer.id, quantity: 6 }, { productId: water.id, quantity: 4 }] })
      .expect(201);
    expect(transfer.body.status).toBe('DRAFT');
    expect(await stockOf(main.body.id, beer.id)).toBe(20);
    await ctx.http().post(`/api/stock-documents/${transfer.body.id}/post`).set(auth).expect(200);
    await ctx.http().post(`/api/stock-documents/${transfer.body.id}/post`).set(auth).expect(409);
    expect(await stockOf(main.body.id, beer.id)).toBe(14);
    expect(await stockOf(bar.body.id, water.id)).toBe(4);
    expect(await ctx.prisma.stockMovement.count({ where: { documentId: transfer.body.id } })).toBe(4);

    const tooMuch = await ctx.http()
      .post('/api/stock-documents')
      .set(auth)
      .send({ type: 'TRANSFER', warehouseId: bar.body.id, toWarehouseId: main.body.id, items: [{ productId: beer.id, quantity: 1 }, { productId: water.id, quantity: 5 }] })
      .expect(201);
    await ctx.http().post(`/api/stock-documents/${tooMuch.body.id}/post`).set(auth).expect(409);
    expect(await stockOf(bar.body.id, beer.id)).toBe(6);
    expect((await ctx.prisma.stockDocument.findUniqueOrThrow({ where: { id: tooMuch.body.id } })).status).toBe('DRAFT');

    const inventory = await ctx.http()
      .post('/api/stock-documents')
      .set(auth)
      .send({ type: 'INVENTORY', warehouseId: main.body.id, items: [{ productId: beer.id, quantity: 12 }, { productId: water.id, quantity: 6 }] })
      .expect(201);
    const posted = await ctx.http().post(`/api/stock-documents/${inventory.body.id}/post`).set(auth).expect(200);
    expect(posted.body.items.map((item: { previousQuantity: string }) => item.previousQuantity)).toEqual(['14', '6']);
    expect(await stockOf(main.body.id, beer.id)).toBe(12);
    expect(await ctx.prisma.stockMovement.count({ where: { documentId: inventory.body.id } })).toBe(1);

    await ctx.http().post('/api/stock-documents').set(auth).send({ type: 'WASTE', warehouseId: bar.body.id, items: [{ productId: beer.id, quantity: 1 }] }).expect(400);
    await ctx.http()
      .post('/api/stock-documents')
      .set(auth)
      .send({ type: 'WASTE', warehouseId: bar.body.id, reason: 'Partidas', items: [{ productId: beer.id, quantity: 1 }, { productId: beer.id, quantity: 2 }] })
      .expect(400);

    const reception = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const receptionAuth = (await login(ctx, reception.email)).auth;
    await ctx.http().post('/api/stock-documents').set(receptionAuth).send({ type: 'INVENTORY', warehouseId: bar.body.id, items: [{ productId: beer.id, quantity: 0 }] }).expect(403);
    const waste = await ctx.http()
      .post('/api/stock-documents')
      .set(receptionAuth)
      .send({ type: 'WASTE', warehouseId: bar.body.id, reason: 'Partidas', items: [{ productId: beer.id, quantity: 2 }] })
      .expect(201);
    await ctx.http().post(`/api/stock-documents/${waste.body.id}/post`).set(receptionAuth).expect(200);
    expect(await stockOf(bar.body.id, beer.id)).toBe(4);

    const listed = await ctx.http().get('/api/stock-documents').query({ hotelId: hotel.id, warehouseId: bar.body.id }).set(auth).expect(200);
    expect(listed.body).toHaveLength(3);
  });
});

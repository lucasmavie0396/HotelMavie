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

  let documents = 0;
  const nextRef = () => `FT ${++documents}`;

  async function receive(supplierId: number, warehouseId: number, productId: number, quantity: number, unitCost: number) {
    const purchase = await ctx.http()
      .post('/api/purchases')
      .set(auth)
      .send({ supplierId, warehouseId, supplierRef: nextRef(), items: [{ productId, quantity, unitCost }] })
      .expect(201);
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

  it('cada categoria abate no seu armazem e sem armazem abate no principal', async () => {
    const { hotel, beer, supplier } = await setup();
    const other = await createHotel(ctx.prisma);
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    const bar = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Bar' }).expect(201);
    const kitchen = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Cozinha' }).expect(201);
    const foreign = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: other.hotel.id, name: 'Outro' }).expect(201);
    await ctx.http().post('/api/product-categories').set(auth).send({ hotelId: hotel.id, name: 'Errada', warehouseId: foreign.body.id }).expect(400);
    const drinks = await ctx.http().post('/api/product-categories').set(auth).send({ hotelId: hotel.id, name: 'Bebidas', warehouseId: bar.body.id }).expect(201);
    expect(drinks.body.warehouseId).toBe(bar.body.id);
    const food = await ctx.http().post('/api/product-categories').set(auth).send({ hotelId: hotel.id, name: 'Comida' }).expect(201);
    await ctx.http().patch(`/api/product-categories/${food.body.id}`).set(auth).send({ warehouseId: foreign.body.id }).expect(400);
    await ctx.http().patch(`/api/product-categories/${food.body.id}`).set(auth).send({ warehouseId: kitchen.body.id }).expect(200);

    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Outra', rate: 16 } });
    const steak = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Bife', price: 0, trackStock: true, sellable: false } });
    const meal = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Bitoque', price: 10, taxRateId: rate.id, categoryId: food.body.id } });
    const juice = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Sumo', price: 2, taxRateId: rate.id, trackStock: true } });
    await ctx.prisma.product.update({ where: { id: beer.id }, data: { categoryId: drinks.body.id } });
    await ctx.http().put(`/api/products/${meal.id}/recipe`).set(auth).send({ items: [{ ingredientId: steak.id, quantity: 0.25 }] }).expect(200);

    await receive(supplier.id, main.body.id, beer.id, 20, 1);
    await receive(supplier.id, main.body.id, steak.id, 4, 5);
    await receive(supplier.id, main.body.id, juice.id, 6, 1);
    const transfer = await ctx.http()
      .post('/api/stock-documents')
      .set(auth)
      .send({ type: 'TRANSFER', warehouseId: main.body.id, toWarehouseId: bar.body.id, items: [{ productId: beer.id, quantity: 10 }] })
      .expect(201);
    await ctx.http().post(`/api/stock-documents/${transfer.body.id}/post`).set(auth).expect(200);
    await ctx.http().post(`/api/warehouses/${main.body.id}/transfer`).set(auth).send({ productId: steak.id, toWarehouseId: kitchen.body.id, quantity: 2 }).expect(201);

    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'RESTAURANT', tableLabel: 'Mesa 1' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: beer.id, quantity: 3 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: meal.id, quantity: 2 }).expect(201);
    const last = await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: juice.id, quantity: 1 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: Number(last.body.total) }] }).expect(200);

    expect(await stockOf(bar.body.id, beer.id)).toBe(7);
    expect(await stockOf(main.body.id, beer.id)).toBe(10);
    expect(await stockOf(kitchen.body.id, steak.id)).toBeCloseTo(1.5, 3);
    expect(await stockOf(main.body.id, steak.id)).toBe(2);
    expect(await stockOf(main.body.id, juice.id)).toBe(5);
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

    const adjust = await ctx.http().post(`/api/warehouses/${main.body.id}/adjust`).set(auth).send({ productId: beer.id, countedQuantity: 10, reason: 'Contagem' }).expect(201);
    expect(adjust.body).toMatchObject({ quantity: '-2', balance: '10' });
    await ctx.http().post(`/api/warehouses/${bar.body.id}/waste`).set(auth).send({ productId: beer.id, quantity: 1, reason: 'Partida' }).expect(201);
    expect(await stockOf(bar.body.id, beer.id)).toBe(7);

    const other = await createHotel(ctx.prisma);
    const foreign = await ctx.prisma.product.create({ data: { hotelId: other.hotel.id, name: 'Alheio', trackStock: true } });
    await ctx.http().post(`/api/warehouses/${main.body.id}/adjust`).set(auth).send({ productId: foreign.id, countedQuantity: 5, reason: 'Contagem' }).expect(404);
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

  it('documentos lancados recebem numero por serie e ano; devolucao exige fornecedor e stock', async () => {
    const { hotel, beer, supplier } = await setup();
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    await receive(supplier.id, main.body.id, beer.id, 10, 1);
    const create = (body: object) => ctx.http().post('/api/stock-documents').set(auth).send({ warehouseId: main.body.id, ...body }).expect(201);
    const post = (id: number) => ctx.http().post(`/api/stock-documents/${id}/post`).set(auth).expect(200);

    const first = await create({ type: 'WASTE', reason: 'Partidas', items: [{ productId: beer.id, quantity: 1 }] });
    const second = await create({ type: 'WASTE', reason: 'Fora de prazo', items: [{ productId: beer.id, quantity: 1 }] });
    await post(second.body.id);
    await post(first.body.id);
    const docs = await ctx.prisma.stockDocument.findMany({ where: { hotelId: hotel.id }, orderBy: { number: 'asc' } });
    expect(docs.map((d) => [d.id, d.number])).toEqual([[second.body.id, 1], [first.body.id, 2]]);
    expect(docs[0].year).toBeGreaterThan(2000);

    await ctx.http().post('/api/stock-documents').set(auth).send({ type: 'RETURN', warehouseId: main.body.id, reason: 'Avariado', items: [{ productId: beer.id, quantity: 1 }] }).expect(400);
    const tooMuch = await create({ type: 'RETURN', supplierId: supplier.id, reason: 'Avariado', items: [{ productId: beer.id, quantity: 50 }] });
    await ctx.http().post(`/api/stock-documents/${tooMuch.body.id}/post`).set(auth).expect(409);
    const returned = await create({ type: 'RETURN', supplierId: supplier.id, reason: 'Avariado', items: [{ productId: beer.id, quantity: 3 }] });
    const posted = await post(returned.body.id);
    expect(posted.body).toMatchObject({ number: 1, supplier: { id: supplier.id } });
    expect(await stockOf(main.body.id, beer.id)).toBe(5);
    expect(await ctx.prisma.stockMovement.count({ where: { documentId: returned.body.id, type: 'RETURN' } })).toBe(1);

    const pdf = await ctx.http().get(`/api/stock-documents/${returned.body.id}/pdf`).query({ paper: 'MM80' }).set(auth).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const sheet = await ctx.http().get(`/api/warehouses/${main.body.id}/count-sheet`).query({ withQuantities: 'true' }).set(auth).expect(200);
    expect(sheet.body.length).toBeGreaterThan(500);

    const waste = await ctx.http().get('/api/reports/view/waste').query({ hotelId: hotel.id, from: day(-1), to: day(1) }).set(auth).expect(200);
    expect(waste.body.sections[0].kpis.find((k: { label: string }) => k.label === 'Linhas devolvidas').value).toBe('1');
  });

  it('lotes com validade saem por FEFO e acompanham as transferencias', async () => {
    const { hotel, supplier } = await setup();
    const milk = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Leite', trackStock: true, trackExpiry: true, minStock: 4 } });
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    const bar = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Bar' }).expect(201);

    const purchase = await ctx.http()
      .post('/api/purchases')
      .set(auth)
      .send({ supplierId: supplier.id, warehouseId: main.body.id, supplierRef: nextRef(), items: [{ productId: milk.id, quantity: 10, unitCost: 1 }] })
      .expect(201);
    const itemId = purchase.body.items[0].id;
    const partial = await ctx.http()
      .post(`/api/purchases/${purchase.body.id}/receive`)
      .set(auth)
      .send({ items: [{ itemId, quantity: 4, lot: 'B', expiryDate: day(20) }] })
      .expect(200);
    expect(partial.body.status).toBe('PARTIAL');
    await ctx.http().post(`/api/purchases/${purchase.body.id}/receive`).set(auth).send({ items: [{ itemId, quantity: 7 }] }).expect(400);
    const done = await ctx.http()
      .post(`/api/purchases/${purchase.body.id}/receive`)
      .set(auth)
      .send({ items: [{ itemId, quantity: 6, lot: 'A', expiryDate: day(5) }] })
      .expect(200);
    expect(done.body.status).toBe('RECEIVED');
    expect(done.body.items[0].receivedQuantity).toBe('10');
    expect(await stockOf(main.body.id, milk.id)).toBe(10);

    const transfer = await ctx.http()
      .post('/api/stock-documents')
      .set(auth)
      .send({ type: 'TRANSFER', warehouseId: main.body.id, toWarehouseId: bar.body.id, items: [{ productId: milk.id, quantity: 8 }] })
      .expect(201);
    await ctx.http().post(`/api/stock-documents/${transfer.body.id}/post`).set(auth).expect(200);
    const mainLots = await ctx.http().get(`/api/warehouses/${main.body.id}/lots`).set(auth).expect(200);
    expect(mainLots.body.map((lot: { code: string; quantity: string }) => [lot.code, lot.quantity])).toEqual([['B', '2']]);
    const barLots = await ctx.http().get(`/api/warehouses/${bar.body.id}/lots`).query({ productId: milk.id }).set(auth).expect(200);
    expect(barLots.body.map((lot: { code: string; quantity: string }) => [lot.code, lot.quantity])).toEqual([['A', '6'], ['B', '2']]);

    const report = await ctx.http().get('/api/reports/view/expiry').query({ hotelId: hotel.id, warehouseId: bar.body.id }).set(auth).expect(200);
    expect(report.body.sections[0].kpis.find((k: { label: string }) => k.label === 'Expiram em 30 dias').value).toBe('2');
    const alerts = await ctx.http().get('/api/notifications').query({ hotelId: hotel.id }).set(auth).expect(200);
    expect(alerts.body.some((alert: { text: string }) => alert.text.includes('Leite'))).toBe(true);
  });

  it('sugestoes de encomenda, encomenda parcial concluida, PDF e envio por email', async () => {
    const { hotel, beer, supplier } = await setup();
    await ctx.prisma.product.update({ where: { id: beer.id }, data: { minStock: 10 } });
    await ctx.prisma.supplier.update({ where: { id: supplier.id }, data: { email: 'encomendas@fornecedor.test' } });
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    await receive(supplier.id, main.body.id, beer.id, 4, 0.9);

    const suggestions = await ctx.http().get('/api/purchases/suggestions').query({ hotelId: hotel.id, warehouseId: main.body.id }).set(auth).expect(200);
    expect(suggestions.body).toHaveLength(1);
    expect(suggestions.body[0]).toMatchObject({ productId: beer.id, suggested: '16', supplier: { id: supplier.id }, unitCost: '0.9' });

    const order = await ctx.http()
      .post('/api/purchases')
      .set(auth)
      .send({ supplierId: supplier.id, warehouseId: main.body.id, items: [{ productId: beer.id, quantity: 16, unitCost: 0.9 }] })
      .expect(201);
    const after = await ctx.http().get('/api/purchases/suggestions').query({ hotelId: hotel.id, warehouseId: main.body.id }).set(auth).expect(200);
    expect(after.body).toHaveLength(0);

    const sent = await ctx.http().post(`/api/purchases/${order.body.id}/send`).set(auth).expect(200);
    expect(sent.body).toMatchObject({ status: 'LOGGED', to: 'encomendas@fornecedor.test' });
    expect((await ctx.prisma.purchase.findUniqueOrThrow({ where: { id: order.body.id } })).sentAt).not.toBeNull();
    const pdf = await ctx.http().get(`/api/purchases/${order.body.id}/pdf`).set(auth).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    await ctx.http().post(`/api/purchases/${order.body.id}/close`).set(auth).expect(409);
    await ctx.http()
      .post(`/api/purchases/${order.body.id}/receive`)
      .set(auth)
      .send({ supplierRef: nextRef(), items: [{ itemId: order.body.items[0].id, quantity: 10 }] })
      .expect(200);
    await ctx.http().post(`/api/purchases/${order.body.id}/cancel`).set(auth).send({}).expect(400);
    const closed = await ctx.http().post(`/api/purchases/${order.body.id}/close`).set(auth).expect(200);
    expect(closed.body.status).toBe('RECEIVED');
    expect(await stockOf(main.body.id, beer.id)).toBe(14);
  });

  it('compras com desconto e IVA por linha, documento unico do fornecedor e anulacao com estorno', async () => {
    const { hotel, beer, supplier } = await setup();
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    const base = { supplierId: supplier.id, warehouseId: main.body.id };

    await ctx.http().post('/api/purchases').set(auth).send({ ...base, items: [{ productId: beer.id, quantity: 2, unitCost: 1, discount: 3 }] }).expect(400);
    await ctx.http().post('/api/purchases').set(auth).send({ ...base, documentDate: day(2), items: [{ productId: beer.id, quantity: 1, unitCost: 1 }] }).expect(400);
    await ctx.http()
      .post('/api/purchases')
      .set(auth)
      .send({ ...base, documentDate: day(0), dueDate: day(-1), items: [{ productId: beer.id, quantity: 1, unitCost: 1 }] })
      .expect(400);

    const draft = await ctx.http()
      .post('/api/purchases')
      .set(auth)
      .send({ ...base, documentDate: day(0), dueDate: day(30), items: [{ productId: beer.id, quantity: 10, unitCost: 2, discount: 4, taxRate: 16 }] })
      .expect(201);
    expect(draft.body).toMatchObject({ subtotal: '20', discount: '4', taxTotal: '2.56', total: '18.56' });
    expect(draft.body.items[0]).toMatchObject({ discount: '4', taxRate: '16', taxAmount: '2.56', total: '18.56' });

    await ctx.http().post(`/api/purchases/${draft.body.id}/receive`).set(auth).send({}).expect(400);
    const received = await ctx.http().post(`/api/purchases/${draft.body.id}/receive`).set(auth).send({ supplierRef: 'FT A/1' }).expect(200);
    expect(received.body.status).toBe('RECEIVED');
    expect(Number((await ctx.prisma.product.findUniqueOrThrow({ where: { id: beer.id } })).cost)).toBeCloseTo(1.6, 4);
    await ctx.http().post('/api/purchases').set(auth).send({ ...base, supplierRef: 'FT A/1', items: [{ productId: beer.id, quantity: 1, unitCost: 1 }] }).expect(409);

    const suppliers = await ctx.http().get('/api/suppliers').query({ hotelId: hotel.id }).set(auth).expect(200);
    expect(suppliers.body.find((row: { id: number }) => row.id === supplier.id)).toMatchObject({ purchaseCount: 1, purchaseTotal: '18.56' });

    await ctx.http().post(`/api/warehouses/${main.body.id}/waste`).set(auth).send({ productId: beer.id, quantity: 4, reason: 'Partida' }).expect(201);
    await ctx.http().post(`/api/purchases/${draft.body.id}/cancel`).set(auth).send({}).expect(400);
    await ctx.http().post(`/api/purchases/${draft.body.id}/cancel`).set(auth).send({ reason: 'Fatura errada' }).expect(409);
    expect(await stockOf(main.body.id, beer.id)).toBe(6);

    const second = await receive(supplier.id, main.body.id, beer.id, 5, 1);
    const voided = await ctx.http().post(`/api/purchases/${second.body.id}/cancel`).set(auth).send({ reason: 'Fatura errada' }).expect(200);
    expect(voided.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Fatura errada' });
    expect(await stockOf(main.body.id, beer.id)).toBe(6);
    expect(await ctx.prisma.stockMovement.count({ where: { purchaseId: second.body.id, type: 'PURCHASE_VOID' } })).toBe(1);
    await ctx.http().post(`/api/purchases/${second.body.id}/cancel`).set(auth).send({ reason: 'De novo' }).expect(409);
    await ctx.http().post('/api/purchases').set(auth).send({ ...base, supplierRef: voided.body.supplierRef, items: [{ productId: beer.id, quantity: 1, unitCost: 1 }] }).expect(201);
  });

  it('fornecedores com NUIT unico e sem desativar com compras por receber', async () => {
    const { hotel, beer, supplier } = await setup();
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    await ctx.http().patch(`/api/suppliers/${supplier.id}`).set(auth).send({ taxId: '400123456' }).expect(200);
    await ctx.http().post('/api/suppliers').set(auth).send({ hotelId: hotel.id, name: 'Outro', taxId: '400123456' }).expect(409);
    await ctx.http().post('/api/purchases').set(auth).send({ supplierId: supplier.id, warehouseId: main.body.id, items: [{ productId: beer.id, quantity: 1, unitCost: 1 }] }).expect(201);
    await ctx.http().patch(`/api/suppliers/${supplier.id}`).set(auth).send({ active: false }).expect(409);
  });

  it('stock negativo recusado salvo autorizacao do produto ou do hotel; ajuste com sinal e motivo', async () => {
    const { hotel, beer, supplier } = await setup();
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    await receive(supplier.id, main.body.id, beer.id, 2, 1);

    const waste = await ctx.http().post(`/api/warehouses/${main.body.id}/waste`).set(auth).send({ productId: beer.id, quantity: 3, reason: 'Partida' }).expect(409);
    expect(waste.body.message).toContain('Stock insuficiente de Cerveja');
    await ctx.http().post(`/api/warehouses/${main.body.id}/adjust`).set(auth).send({ productId: beer.id, quantity: 5 }).expect(400);
    await ctx.http().post(`/api/warehouses/${main.body.id}/adjust`).set(auth).send({ productId: beer.id, quantity: -3, reason: 'Erro' }).expect(409);
    const plus = await ctx.http().post(`/api/warehouses/${main.body.id}/adjust`).set(auth).send({ productId: beer.id, quantity: 1, reason: 'Encontrada' }).expect(201);
    expect(plus.body).toMatchObject({ quantity: '1', balance: '3' });

    const order = await ctx.http().post('/api/orders').set(auth).send({ hotelId: hotel.id, outlet: 'BAR' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(auth).send({ productId: beer.id, quantity: 4 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 10 }] }).expect(409);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.body.id } })).status).toBe('OPEN');
    expect(await stockOf(main.body.id, beer.id)).toBe(3);

    await ctx.http().patch(`/api/products/${beer.id}`).set(auth).send({ allowNegativeStock: true }).expect(200);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(auth).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 10 }] }).expect(200);
    expect(await stockOf(main.body.id, beer.id)).toBe(-1);

    await ctx.prisma.product.update({ where: { id: beer.id }, data: { allowNegativeStock: false } });
    await ctx.http().post(`/api/warehouses/${main.body.id}/waste`).set(auth).send({ productId: beer.id, quantity: 1, reason: 'Partida' }).expect(409);
    await ctx.http().patch(`/api/hotels/${hotel.id}`).set(auth).send({ allowNegativeStock: true }).expect(200);
    await ctx.http().post(`/api/warehouses/${main.body.id}/waste`).set(auth).send({ productId: beer.id, quantity: 1, reason: 'Partida' }).expect(201);
    expect(await stockOf(main.body.id, beer.id)).toBe(-2);
  });

  it('inventario abre com todos os produtos e o saldo, um aberto por armazem, e inventario a zero', async () => {
    const { hotel, beer, supplier } = await setup();
    const water = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Agua', trackStock: true } });
    const main = await ctx.http().post('/api/warehouses').set(auth).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    await receive(supplier.id, main.body.id, beer.id, 10, 1);
    await receive(supplier.id, main.body.id, water.id, 4, 0.5);

    const inventory = await ctx.http().post('/api/stock-documents/inventory').set(auth).send({ warehouseId: main.body.id }).expect(201);
    expect(inventory.body).toMatchObject({ type: 'INVENTORY', status: 'DRAFT' });
    const lines = (inventory.body.items as { productId: number; quantity: string; previousQuantity: string }[]).map((item) => [item.productId, item.quantity, item.previousQuantity]);
    expect(lines.sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
      [beer.id, '10', '10'],
      [water.id, '4', '4'],
    ]);
    await ctx.http().post('/api/stock-documents/inventory').set(auth).send({ warehouseId: main.body.id }).expect(409);
    await ctx.http()
      .post('/api/stock-documents')
      .set(auth)
      .send({ type: 'INVENTORY', warehouseId: main.body.id, items: [{ productId: beer.id, quantity: 1 }] })
      .expect(409);

    const counted = await ctx.http()
      .patch(`/api/stock-documents/${inventory.body.id}`)
      .set(auth)
      .send({ type: 'INVENTORY', warehouseId: main.body.id, items: [{ productId: beer.id, quantity: 8 }, { productId: water.id, quantity: 4 }] })
      .expect(200);
    expect(counted.body.items.find((item: { productId: number }) => item.productId === beer.id).previousQuantity).toBe('10');
    await ctx.http().post(`/api/stock-documents/${inventory.body.id}/post`).set(auth).expect(200);
    expect(await stockOf(main.body.id, beer.id)).toBe(8);
    expect(await stockOf(main.body.id, water.id)).toBe(4);

    const zero = await ctx.http().post('/api/stock-documents/inventory').set(auth).send({ warehouseId: main.body.id, zero: true }).expect(201);
    expect(zero.body.reason).toContain('a zero');
    expect(zero.body.items.every((item: { quantity: string }) => item.quantity === '0')).toBe(true);
    await ctx.http().post(`/api/stock-documents/${zero.body.id}/post`).set(auth).expect(200);
    expect(await stockOf(main.body.id, beer.id)).toBe(0);
    expect(await stockOf(main.body.id, water.id)).toBe(0);
  });
});

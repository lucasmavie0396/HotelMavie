import { UserRole } from '@prisma/client';
import { REPORTS } from '../src/reports/report-builder.service';
import { formatCurrency } from '../src/common/money';
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

  it('gera todos os relatorios em JSON, A4 e 80 mm com os dados do periodo', async () => {
    const { hotel, manager } = await setup();
    const catalog = await ctx.http().get('/api/reports/catalog').set(manager).expect(200);
    const listed = REPORTS.filter((report) => !report.hidden);
    expect(catalog.body.map((report: { key: string }) => report.key)).toEqual(listed.map((report) => report.key));

    const params = { hotelId: hotel.id, from: day(-1), to: day(1), date: day(0) };
    for (const { key } of listed) {
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
  }, 120_000);

  it('previsao, saldos dos hospedes, cancelamentos e vendas por empregado', async () => {
    const { hotel, manager } = await setup();
    const rooms = await ctx.prisma.room.findMany({ where: { hotelId: hotel.id }, orderBy: { number: 'asc' } });
    const guest = await createGuest(ctx.prisma, hotel.id);
    const upcoming = await ctx.http().post('/api/reservations').set(manager).send({ guestId: guest.id, roomId: rooms[1].id, checkIn: day(3), checkOut: day(5) }).expect(201);
    const dropped = await ctx.http().post('/api/reservations').set(manager).send({ guestId: guest.id, roomId: rooms[2].id, checkIn: day(1), checkOut: day(4) }).expect(201);
    await ctx.http().post(`/api/reservations/${dropped.body.id}/cancel`).set(manager).expect(200);

    const forecast = (await ctx.http().get('/api/reports/view/forecast').query({ hotelId: hotel.id, from: day(0), to: day(6) }).set(manager).expect(200)).body;
    expect(forecast.sections[1].table.rows).toHaveLength(7);
    const arrivals = forecast.sections[2].table.rows.map((row: string[]) => row[0]);
    expect(arrivals).toHaveLength(2);
    expect(arrivals).toContain(upcoming.body.code);
    expect(arrivals).not.toContain(dropped.body.code);
    const defaults = (await ctx.http().get('/api/reports/view/forecast').query({ hotelId: hotel.id }).set(manager).expect(200)).body;
    expect(defaults.sections[1].table.rows).toHaveLength(30);

    const cancellations = (await ctx.http().get('/api/reports/view/cancellations').query({ hotelId: hotel.id, from: day(0), to: day(6) }).set(manager).expect(200)).body;
    const kpis = Object.fromEntries(cancellations.sections[0].kpis.map((kpi: { label: string; value: string }) => [kpi.label, kpi.value]));
    expect(kpis).toMatchObject({ Cancelamentos: '1', 'No-shows': '0', 'Noites perdidas': '3' });
    expect(cancellations.sections[2].table.rows[0][0]).toBe(dropped.body.code);

    const stay = await ctx.prisma.reservation.findFirstOrThrow({ where: { hotelId: hotel.id, status: 'CHECKED_IN' } });
    const folio = (await ctx.http().get(`/api/reservations/${stay.id}/folio`).set(manager).expect(200)).body;
    const balances = (await ctx.http().get('/api/reports/view/balances').query({ hotelId: hotel.id }).set(manager).expect(200)).body;
    expect(balances.sections[1].table.rows).toHaveLength(1);
    expect(balances.sections[1].table.rows[0][0]).toBe('101');
    expect(balances.sections[1].table.rows[0][7]).toBe(formatCurrency(folio.balance, 'EUR'));

    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 16 } });
    const product = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Sumo', price: 3, taxRateId: rate.id } });
    const order = await ctx.http().post('/api/orders').set(manager).send({ hotelId: hotel.id, outlet: 'BAR', tableLabel: 'Balcao' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(manager).send({ productId: product.id, quantity: 2 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(manager).send({ mode: 'PAY', payments: [{ method: 'CARD', amount: 6 }] }).expect(200);
    const seller = await ctx.prisma.user.findFirstOrThrow({ where: { hotelId: hotel.id, role: 'MANAGER' } });
    const staff = (await ctx.http().get('/api/reports/view/staff').query({ hotelId: hotel.id, from: day(0), to: day(0) }).set(manager).expect(200)).body;
    expect(staff.sections[1].table.rows[0]).toEqual(expect.arrayContaining([seller.name, '1', '2', formatCurrency(6, 'EUR')]));
    expect(staff.sections[2].table.rows).toHaveLength(1);
  });

  it('a rececao so ve os relatorios operacionais e o relatorio imprime por ESC/POS', async () => {
    const { hotel, reception, manager } = await setup();
    const catalog = await ctx.http().get('/api/reports/catalog').set(reception).expect(200);
    expect(catalog.body.map((report: { key: string }) => report.key).sort()).toEqual(['balances', 'forecast', 'guests', 'reservations']);
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

  it('compras, quartos, margem, movimentos de stock, hospedes e recursos humanos com os valores do periodo', async () => {
    const { hotel, manager } = await setup();
    const params = { hotelId: hotel.id, from: day(-1), to: day(1) };
    const view = async (key: string) => (await ctx.http().get(`/api/reports/view/${key}`).query(params).set(manager).expect(200)).body;
    const kpi = (body: { sections: { kpis?: { label: string; value: string }[] }[] }, label: string) => body.sections[0].kpis!.find((item) => item.label === label)!.value;
    const money = (value: number) => formatCurrency(value, hotel.currency);

    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 16 } });
    const supplier = await ctx.prisma.supplier.create({ data: { hotelId: hotel.id, name: 'Distribuidora', taxId: '400111222' } });
    const warehouse = await ctx.http().post('/api/warehouses').set(manager).send({ hotelId: hotel.id, name: 'Economato' }).expect(201);
    const beer = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Cerveja', price: 11.6, taxRateId: rate.id, trackStock: true } });
    const purchase = await ctx.http()
      .post('/api/purchases')
      .set(manager)
      .send({ supplierId: supplier.id, warehouseId: warehouse.body.id, supplierRef: 'FT 9/1', documentDate: day(0), dueDate: day(0), items: [{ productId: beer.id, quantity: 10, unitCost: 5, discount: 10, taxRate: 16 }] })
      .expect(201);
    await ctx.http().post(`/api/purchases/${purchase.body.id}/receive`).set(manager).send({}).expect(200);
    await ctx.http().post('/api/purchases').set(manager).send({ supplierId: supplier.id, warehouseId: warehouse.body.id, items: [{ productId: beer.id, quantity: 2, unitCost: 5 }] }).expect(201);

    const stay = await ctx.prisma.reservation.findFirstOrThrow({ where: { hotelId: hotel.id, status: 'CHECKED_IN' } });
    const order = await ctx.http().post('/api/orders').set(manager).send({ hotelId: hotel.id, outlet: 'BAR' }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/items`).set(manager).send({ productId: beer.id, quantity: 2 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/close`).set(manager).send({ mode: 'ROOM', reservationId: stay.id }).expect(200);

    const purchases = await view('purchases');
    expect(kpi(purchases, 'Compras recebidas')).toBe('1');
    expect(kpi(purchases, 'Base (sem IVA)')).toBe(money(40));
    expect(kpi(purchases, 'IVA das compras')).toBe(money(6.4));
    expect(kpi(purchases, 'Encomendas por receber')).toBe('1');
    expect(purchases.sections[1].table.rows[0]).toEqual(['Distribuidora', '400111222', '1', money(40), money(6.4), money(46.4), '100%']);
    expect(purchases.sections[2].table.rows[0]).toEqual(['16%', '1', money(40), money(6.4)]);

    const rooms = await view('rooms');
    expect(kpi(rooms, 'Noites vendidas')).toBe('2 de 9');
    const room101 = rooms.sections[2].table.rows.find((row: string[]) => row[0] === '101');
    expect(room101.slice(4, 7)).toEqual(['1', '2', '66,7%']);
    expect(room101[3]).toContain('(hotel)');

    const margin = await view('margin');
    expect(kpi(margin, 'Vendas sem IVA')).toBe(money(20));
    expect(kpi(margin, 'Custo')).toBe(money(8));
    expect(kpi(margin, 'Margem %')).toBe('60%');

    const movements = await view('stock-movements');
    expect(kpi(movements, 'Movimentos')).toBe('2');
    expect(kpi(movements, 'Valor das entradas')).toBe(money(40));
    expect(kpi(movements, 'Valor das saidas')).toBe(money(8));

    const guests = await view('guest-stats');
    expect(kpi(guests, 'Estadias')).toBe('1');
    expect(guests.sections[1].table.rows[0].slice(0, 2)).toEqual(['Mocambicana', '1']);

    const employee = await ctx.prisma.employee.create({
      data: { hotelId: hotel.id, fullName: 'Ana Silva', jobTitle: 'Rececionista', startDate: new Date('2020-01-01'), baseSalary: 1000, weeklyHours: 40, irsRate: 10 },
    });
    const now = new Date();
    await ctx.prisma.timeEntry.create({ data: { hotelId: hotel.id, employeeId: employee.id, clockIn: new Date(now.getTime() - 8 * 3_600_000), clockOut: now } });
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await ctx.http().post('/api/hr/payroll/runs').set(manager).send({ hotelId: hotel.id, month }).expect(201);
    const hr = await view('hr');
    expect(kpi(hr, 'Funcionarios ativos')).toBe('1');
    expect(hr.sections[1].table.rows[0][1]).toBe('Ana Silva');
    expect(hr.sections[2].table.rows[0].slice(0, 4)).toEqual(['Ana Silva', 'Rececionista', '1', '8']);
  });
});

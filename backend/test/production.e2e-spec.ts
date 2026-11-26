import { UserRole } from '@prisma/client';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from './helpers';

type Helpers = typeof import('./helpers');

const DUMP = 'C:/xampp/mysql/bin/mysqldump.exe';
const sqlServer = (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '').startsWith('sqlserver:');
const canDump = !sqlServer && existsSync(DUMP);

describe('Inicio da producao e limpeza tecnica', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;
  let helpers: Helpers;
  const dir = mkdtempSync(join(tmpdir(), 'mavie-producao-'));

  beforeAll(async () => {
    process.env.BACKUP_DIR = dir;
    if (canDump) process.env.MYSQLDUMP_PATH = DUMP;
    helpers = await import('./helpers');
    ctx = await helpers.createApp();
    auth = (await helpers.login(ctx, (await helpers.createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
  });

  afterAll(async () => {
    delete process.env.BACKUP_DIR;
    delete process.env.MYSQLDUMP_PATH;
    rmSync(dir, { recursive: true, force: true });
    await ctx.app.close();
  });

  async function withData() {
    const { hotel, rooms } = await helpers.createHotel(ctx.prisma);
    const guest = await helpers.createGuest(ctx.prisma, hotel.id);
    const reservation = await ctx.http().post('/api/reservations').set(auth).send({ guestId: guest.id, roomId: rooms[0].id, checkIn: helpers.day(0), checkOut: helpers.day(1) }).expect(201);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/check-in`).set(auth).expect(200);
    await ctx.http().post(`/api/reservations/${reservation.body.id}/payments`).set(auth).send({ amount: 80, method: 'CARD' }).expect(201);
    const folio = await ctx.http().get(`/api/reservations/${reservation.body.id}/folio`).set(auth).expect(200);
    await ctx.http()
      .post(`/api/reservations/${reservation.body.id}/invoices`)
      .set(auth)
      .send({ type: 'INVOICE_RECEIPT', chargeIds: folio.body.charges.map((charge: { id: number }) => charge.id) })
      .expect(201);
    const product = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Agua', price: 1, trackStock: true } });
    return { hotel, rooms, product };
  }

  (canDump ? it : it.skip)('apaga os dados de teste uma unica vez, com copia, e mantem configuracoes e produtos', async () => {
    const { hotel, rooms, product } = await withData();
    const status = await ctx.http().get('/api/system/production').query({ hotelId: hotel.id }).set(auth).expect(200);
    expect(status.body).toMatchObject({ inProduction: false, confirmation: 'APAGAR DADOS DE TESTE', counts: { reservations: 1, guests: 1, invoices: 1 } });

    await ctx.http().post('/api/system/production').set(auth).send({ hotelId: hotel.id, deleteTestData: true, confirmation: 'apagar' }).expect(400);
    const started = await ctx.http().post('/api/system/production').set(auth).send({ hotelId: hotel.id, deleteTestData: true, confirmation: 'APAGAR DADOS DE TESTE' }).expect(200);
    expect(started.body).toMatchObject({ deleted: true });
    expect(readdirSync(dir).some((name) => name === started.body.backup)).toBe(true);

    expect(await ctx.prisma.reservation.count({ where: { hotelId: hotel.id } })).toBe(0);
    expect(await ctx.prisma.invoice.count({ where: { hotelId: hotel.id } })).toBe(0);
    expect(await ctx.prisma.guest.count({ where: { hotelId: hotel.id } })).toBe(0);
    expect(await ctx.prisma.room.count({ where: { hotelId: hotel.id } })).toBe(rooms.length);
    expect(await ctx.prisma.product.count({ where: { id: product.id } })).toBe(1);
    const series = await ctx.prisma.invoiceSeries.findMany({ where: { hotelId: hotel.id } });
    expect(series.every((item) => item.nextNumber === 1 && item.lastHash === null)).toBe(true);
    expect(await ctx.prisma.auditLog.count({ where: { hotelId: hotel.id, action: 'PRODUCTION_START' } })).toBe(1);

    await ctx.http().post('/api/system/production').set(auth).send({ hotelId: hotel.id, deleteTestData: true, confirmation: 'APAGAR DADOS DE TESTE' }).expect(409);
  });

  it('passa a producao mantendo os dados; so o administrador; limpeza de copias antigas', async () => {
    const { hotel } = await withData();
    const manager = await helpers.createUser(ctx.prisma, UserRole.MANAGER, hotel.id);
    const managerAuth = (await helpers.login(ctx, manager.email)).auth;
    await ctx.http().post('/api/system/production').set(managerAuth).send({ hotelId: hotel.id, deleteTestData: false }).expect(403);
    await ctx.http().post('/api/system/production').set(auth).send({ hotelId: hotel.id, deleteTestData: false }).expect(200);
    expect(await ctx.prisma.reservation.count({ where: { hotelId: hotel.id } })).toBe(1);
    const status = await ctx.http().get('/api/system/production').query({ hotelId: hotel.id }).set(auth).expect(200);
    expect(status.body.inProduction).toBe(true);

    for (let index = 0; index < 10; index++) {
      writeFileSync(join(dir, `mavie-202601${String(index + 10)}-120000.sql`), 'x');
    }
    const before = readdirSync(dir).filter((name) => /^mavie-\d{8}-\d{6}\.(sql|bak)$/.test(name)).length;
    const cleanup = await ctx.http().get('/api/system/cleanup').query({ hotelId: hotel.id }).set(auth).expect(200);
    expect(cleanup.body.items.find((item: { type: string }) => item.type === 'BACKUPS').count).toBe(Math.max(0, before - 7));
    const done = await ctx.http().post('/api/system/cleanup').set(auth).send({ hotelId: hotel.id, type: 'BACKUPS', value: 2 }).expect(200);
    expect(done.body.removed).toBe(Math.max(0, before - 7));
    expect(readdirSync(dir).filter((name) => /^mavie-\d{8}-\d{6}\.(sql|bak)$/.test(name))).toHaveLength(Math.min(before, 7));
  });
});

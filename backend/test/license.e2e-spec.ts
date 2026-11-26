import { UserRole } from '@prisma/client';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { encodeLicense, encodeUnlock, unlockRequest } from '../src/license/license-format';
import { LicenseService } from '../src/license/license.service';
import { createApp, createHotel, createUser, login, TestContext } from './helpers';

describe('Licenciamento', () => {
  let ctx: TestContext;
  let admin: Record<string, string>;
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const iso = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const license = (nuit: string, from: number, to: number, key = keys.privateKey) =>
    encodeLicense({ id: randomUUID(), name: 'Hotel Teste', nuit, issuedAt: iso(from), validUntil: iso(to), v: 1 }, key);

  beforeAll(async () => {
    process.env.LICENSE_PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    ctx = await createApp();
    admin = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
  });

  afterAll(async () => {
    delete process.env.LICENSE_PUBLIC_KEY;
    await ctx.app.close();
  });

  const refresh = (hotelId: number) => ctx.app.get(LicenseService).invalidate(hotelId);

  it('periodo inicial, bloqueio sem licenca, ativacao e validade', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { taxId: '400123456' } });
    const manager = await createUser(ctx.prisma, UserRole.MANAGER, hotel.id);
    const auth = (await login(ctx, manager.email)).auth;
    const write = () => ctx.http().post('/api/guests').set(auth).send({ firstName: 'Ana', lastName: 'Teste' });

    const trial = await ctx.http().get('/api/license').query({ hotelId: hotel.id }).set(auth).expect(200);
    expect(trial.body).toMatchObject({ state: 'TRIAL', blocked: false });
    await write().expect(201);

    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { licenseGraceUntil: new Date(Date.now() - 1000) } });
    refresh(hotel.id);
    const blocked = await write().expect(403);
    expect(blocked.body.message).toContain('sem licenca');
    await ctx.http().get('/api/guests').query({ hotelId: hotel.id }).set(auth).expect(200);

    await ctx.http().post('/api/license').set(auth).send({ hotelId: hotel.id, text: license('400123456', 0, 30) }).expect(403);
    await ctx.http().post('/api/license').set(admin).send({ hotelId: hotel.id, text: license('400999999', 0, 30) }).expect(400);
    await ctx.http().post('/api/license').set(admin).send({ hotelId: hotel.id, text: license('400123456', 0, 30, other.privateKey) }).expect(400);
    const text = license('400123456', 0, 30);
    const tampered = text.replace(/\.([^.]+)\./, (match, data: string) => `.${Buffer.from(Buffer.from(data, 'base64url').toString().replace('2', '3')).toString('base64url')}.`);
    await ctx.http().post('/api/license').set(admin).send({ hotelId: hotel.id, text: tampered }).expect(400);

    const active = await ctx.http().post('/api/license').set(admin).send({ hotelId: hotel.id, text: `  ${text.slice(0, 20)}\n${text.slice(20)} ` }).expect(200);
    expect(active.body).toMatchObject({ state: 'VALID', blocked: false, nuit: '400123456', validUntil: iso(30) });
    await write().expect(201);
    await ctx.http().post('/api/license').set(admin).send({ hotelId: hotel.id, text: license('400123456', 0, 10) }).expect(400);

    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { licenseText: license('400123456', -30, 3) } });
    refresh(hotel.id);
    expect((await ctx.http().get('/api/license').query({ hotelId: hotel.id }).set(auth).expect(200)).body.state).toBe('EXPIRING');
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { licenseText: license('400123456', -40, -3) } });
    refresh(hotel.id);
    expect((await ctx.http().get('/api/license').query({ hotelId: hotel.id }).set(auth).expect(200)).body.state).toBe('GRACE');
    await write().expect(201);
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { licenseText: license('400123456', -40, -8) } });
    refresh(hotel.id);
    expect((await ctx.http().get('/api/license').query({ hotelId: hotel.id }).set(auth).expect(200)).body).toMatchObject({ state: 'EXPIRED', blocked: true });
    await write().expect(403);
  });

  it('relogio atrasado bloqueia e o codigo de desbloqueio vale uma vez', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const future = new Date(Date.now() + 3 * 86_400_000);
    await ctx.prisma.hotel.update({ where: { id: hotel.id }, data: { taxId: '400555666', licenseText: license('400555666', 0, 60), licenseLastSeenAt: future } });
    refresh(hotel.id);
    const status = await ctx.http().get('/api/license').query({ hotelId: hotel.id }).set(admin).expect(200);
    const request = unlockRequest('400555666', future);
    expect(status.body).toMatchObject({ state: 'CLOCK', blocked: true, unlockRequest: request });

    const code = (forRequest: string) => encodeUnlock({ id: randomUUID(), nuit: '400555666', request: forRequest, issuedAt: iso(0), validUntil: iso(3), v: 1 }, keys.privateKey);
    await ctx.http().post('/api/license/unlock').set(admin).send({ hotelId: hotel.id, text: code('400555666-202001010000') }).expect(400);
    const unlockCode = code(request);
    const unlocked = await ctx.http().post('/api/license/unlock').set(admin).send({ hotelId: hotel.id, text: unlockCode }).expect(200);
    expect(unlocked.body.state).toBe('VALID');
    await ctx.http().post('/api/license/unlock').set(admin).send({ hotelId: hotel.id, text: unlockCode }).expect(400);
  });
});

import { UserRole } from '@prisma/client';
import { domainVariants, normalizeDomain, siteTarget } from '../src/hotels/domains';
import { createApp, createHotel, createUser, login, TestContext, uid } from './helpers';

describe('Dominio proprio do hotel', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('guarda o dominio normalizado, abre o site pelo dominio e impede duplicados', async () => {
    const admin = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
    const id = uid();
    const created = await ctx.http()
      .post('/api/hotels')
      .set(admin)
      .send({ name: `Hotel Dominio ${id}`, publicSlug: `dominio-${id}`, publicEnabled: true, customDomain: `https://WWW.Hotel-${id}.co.mz/reservas` })
      .expect(201);
    expect(created.body.customDomain).toBe(`www.hotel-${id}.co.mz`);

    for (const host of [`www.hotel-${id}.co.mz`, `hotel-${id}.co.mz`, `HOTEL-${id}.CO.MZ`]) {
      const resolved = await ctx.http().get('/api/public/domain').query({ host }).expect(200);
      expect(resolved.body).toEqual({ slug: `dominio-${id}` });
    }
    expect((await ctx.http().get('/api/public/domain').query({ host: 'localhost' }).expect(200)).body).toEqual({ slug: null });
    expect((await ctx.http().get('/api/public/domain').query({ host: 'outro-hotel.co.mz' }).expect(200)).body).toEqual({ slug: null });

    const { hotel: other } = await createHotel(ctx.prisma);
    await ctx.http().patch(`/api/hotels/${other.id}`).set(admin).send({ customDomain: `hotel-${id}.co.mz` }).expect(409);
    for (const invalid of ['nao e dominio', '192.168.1.10', 'localhost', 'a.b']) {
      await ctx.http().patch(`/api/hotels/${other.id}`).set(admin).send({ customDomain: invalid }).expect(400);
    }

    await ctx.prisma.hotel.update({ where: { id: created.body.id }, data: { publicEnabled: false } });
    expect((await ctx.http().get('/api/public/domain').query({ host: `hotel-${id}.co.mz` }).expect(200)).body).toEqual({ slug: null });

    const cleared = await ctx.http().patch(`/api/hotels/${created.body.id}`).set(admin).send({ customDomain: null }).expect(200);
    expect(cleared.body.customDomain).toBeNull();
    await ctx.http().patch(`/api/hotels/${other.id}`).set(admin).send({ customDomain: `hotel-${id}.co.mz` }).expect(200);
  });

  it('verifica o DNS e da as instrucoes para o servidor do sistema', async () => {
    const admin = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
    const { hotel } = await createHotel(ctx.prisma);
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    await ctx.http().get(`/api/hotels/${hotel.id}/domain-check`).set(admin).expect(400);
    await ctx.http().patch(`/api/hotels/${hotel.id}`).set(admin).send({ customDomain: `hotel-${uid()}.invalid` }).expect(200);

    process.env.SITE_DNS_TARGET = '203.0.113.10';
    try {
      const check = await ctx.http().get(`/api/hotels/${hotel.id}/domain-check`).set(admin).expect(200);
      expect(check.body).toMatchObject({ target: '203.0.113.10', ok: false });
      expect(check.body.instructions).toEqual([
        { type: 'A', name: expect.stringMatching(/^hotel-/), value: '203.0.113.10' },
        { type: 'A', name: expect.stringMatching(/^www\.hotel-/), value: '203.0.113.10' },
      ]);
      expect(check.body.records.every((record: { exists: boolean }) => !record.exists)).toBe(true);
      await ctx.http().patch(`/api/hotels/${hotel.id}`).set(admin).send({ customDomain: '203.0.113.10' }).expect(400);
    } finally {
      delete process.env.SITE_DNS_TARGET;
    }
    await ctx.http().get(`/api/hotels/${hotel.id}/domain-check`).set(manager).expect(403);
  });

  it('normaliza e calcula as variantes do dominio', () => {
    expect(normalizeDomain(' HTTPS://Www.Exemplo.CO.MZ:443/a?b ')).toBe('www.exemplo.co.mz');
    expect(normalizeDomain('')).toBeNull();
    expect(domainVariants('www.exemplo.co.mz').sort()).toEqual(['exemplo.co.mz', 'www.exemplo.co.mz']);
    expect(siteTarget(undefined, 'http://localhost:5173')).toBeNull();
    expect(siteTarget(undefined, 'https://hgest.exemplo.co.mz')).toBe('hgest.exemplo.co.mz');
    expect(siteTarget('41.220.1.5', 'https://hgest.exemplo.co.mz')).toBe('41.220.1.5');
  });
});

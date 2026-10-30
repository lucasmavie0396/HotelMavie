import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isPrivateAddress, UploadsService } from '../src/uploads/uploads';
import { createApp, createHotel, createUser, login, TestContext } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Fotos dos produtos', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('carrega, substitui e remove a foto do produto', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const reception = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email)).auth;
    const product = await ctx.http().post('/api/products').set(manager).send({ hotelId: hotel.id, name: 'Sumo', price: 3 }).expect(201);
    const dir = ctx.app.get(UploadsService).dir;

    await ctx.http().post(`/api/products/${product.body.id}/image`).set(reception).send({ data: PNG.toString('base64') }).expect(403);
    await ctx.http().post(`/api/products/${product.body.id}/image`).set(manager).send({}).expect(400);
    const first = await ctx.http().post(`/api/products/${product.body.id}/image`).set(manager).send({ data: `data:image/png;base64,${PNG.toString('base64')}` }).expect(201);
    expect(first.body.imageFile).toMatch(/^[a-f0-9]{32}\.png$/);
    const second = await ctx.http().post(`/api/products/${product.body.id}/image`).set(manager).send({ data: PNG.toString('base64') }).expect(201);
    expect(existsSync(join(dir, first.body.imageFile))).toBe(false);
    expect(existsSync(join(dir, second.body.imageFile))).toBe(true);

    const list = await ctx.http().get(`/api/products?hotelId=${hotel.id}`).set(reception).expect(200);
    expect(list.body[0].imageFile).toBe(second.body.imageFile);

    const removed = await ctx.http().delete(`/api/products/${product.body.id}/image`).set(manager).expect(200);
    expect(removed.body.imageFile).toBeNull();
    expect(existsSync(join(dir, second.body.imageFile))).toBe(false);

    const other = await createHotel(ctx.prisma);
    const outsider = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, other.hotel.id)).email)).auth;
    await ctx.http().post(`/api/products/${product.body.id}/image`).set(outsider).send({ data: PNG.toString('base64') }).expect(404);
  });

  it('recusa links que nao sao https ou que apontam para a rede interna', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const product = await ctx.http().post('/api/products').set(manager).send({ hotelId: hotel.id, name: 'Cha', price: 2 }).expect(201);
    const send = (url: string) => ctx.http().post(`/api/products/${product.body.id}/image`).set(manager).send({ url });

    await send('http://example.com/foto.jpg').expect(400);
    await send('file:///etc/passwd').expect(400);
    for (const url of ['https://127.0.0.1/a.png', 'https://localhost:3000/api/health', 'https://10.0.0.5/a.png', 'https://[::1]/a.png', 'https://169.254.169.254/latest/meta-data']) {
      const response = await send(url).expect(400);
      expect(JSON.stringify(response.body.message)).toMatch(/interno|https|descarregar/);
    }
    await ctx.http().get('/api/products/image-search?q=a').set(manager).expect(400);
  });

  it('pesquisa no Google quando ha chave e no Wikimedia quando nao ha', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = (await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email)).auth;
    const reception = (await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email)).auth;
    const calls: string[] = [];
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://www.googleapis.com/customsearch/v1')) {
        if (url.includes('q=erro')) return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 });
        const start = new URL(url).searchParams.get('start');
        return Response.json({
          items:
            start === '1'
              ? [
                  { title: 'Cerveja <b>2M</b>', link: 'https://exemplo.co.mz/2m.jpg', mime: 'image/jpeg', displayLink: 'exemplo.co.mz', image: { contextLink: 'https://exemplo.co.mz/', thumbnailLink: 'https://encrypted-tbn0.gstatic.com/a' } },
                  { title: 'Inseguro', link: 'http://exemplo.co.mz/x.jpg', mime: 'image/jpeg' },
                  { title: 'Gif', link: 'https://exemplo.co.mz/x.gif', mime: 'image/gif' },
                ]
              : [{ title: 'Repetida', link: 'https://exemplo.co.mz/2m.jpg', mime: 'image/jpeg' }],
        });
      }
      return Response.json({
        query: { pages: { '1': { title: 'File:Cerveja.jpg', index: 1, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/c.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } } }] } } },
      });
    });
    const config = ctx.app.get(ConfigService);
    config.set('GOOGLE_SEARCH_API_KEY', '');
    config.set('GOOGLE_SEARCH_CX', '');
    try {
      await ctx.http().get('/api/products/image-search?q=cerveja').set(reception).expect(403);

      const wiki = await ctx.http().get('/api/products/image-search?q=cerveja').set(manager).expect(200);
      expect(wiki.body).toMatchObject({ provider: 'wikimedia', results: [{ title: 'Cerveja', url: 'https://upload.wikimedia.org/c.jpg', thumb: 'https://upload.wikimedia.org/c.jpg', license: 'CC BY 4.0' }] });

      config.set('GOOGLE_SEARCH_API_KEY', 'chave-teste');
      config.set('GOOGLE_SEARCH_CX', 'motor-teste');
      calls.length = 0;
      const google = await ctx.http().get('/api/products/image-search?q=cerveja 2M').set(manager).expect(200);
      expect(google.body.provider).toBe('google');
      expect(google.body.results).toEqual([
        { title: 'Cerveja 2M', url: 'https://exemplo.co.mz/2m.jpg', thumb: 'https://encrypted-tbn0.gstatic.com/a', source: 'https://exemplo.co.mz/', license: null, author: 'exemplo.co.mz' },
      ]);
      expect(calls).toHaveLength(2);
      const params = new URL(calls[0]).searchParams;
      expect(params.get('searchType')).toBe('image');
      expect(params.get('safe')).toBe('active');
      expect(params.get('cx')).toBe('motor-teste');

      const failed = await ctx.http().get('/api/products/image-search?q=erro').set(manager).expect(502);
      expect(failed.body.message).toContain('Quota exceeded');
    } finally {
      config.set('GOOGLE_SEARCH_API_KEY', '');
      config.set('GOOGLE_SEARCH_CX', '');
      fetchMock.mockRestore();
    }
  });

  it('classifica enderecos privados e publicos', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    for (const address of ['8.8.8.8', '185.15.59.240', '2606:4700::6810:84e5']) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });
});

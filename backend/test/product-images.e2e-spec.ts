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

  it('classifica enderecos privados e publicos', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    for (const address of ['8.8.8.8', '185.15.59.240', '2606:4700::6810:84e5']) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });
});

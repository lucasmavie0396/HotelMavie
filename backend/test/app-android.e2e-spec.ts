import { UserRole } from '@prisma/client';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, createUser, login, TestContext } from './helpers';

describe('App Android servida pelo servidor', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;
  const folder = mkdtempSync(join(tmpdir(), 'mavie-apk-'));
  const file = join(folder, 'MAVIE-HGest.apk');

  beforeAll(async () => {
    process.env.APP_APK_FILE = file;
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(async () => {
    delete process.env.APP_APK_FILE;
    rmSync(folder, { recursive: true, force: true });
    await ctx.app.close();
  });

  it('sem APK responde 404; com APK descarrega sem sessao e mostra os QR so a utilizadores', async () => {
    await ctx.http().get('/api/app/MAVIE-HGest.apk').expect(404);
    const empty = await ctx.http().get('/api/app/info').set(auth).expect(200);
    expect(empty.body.available).toBe(false);

    writeFileSync(file, Buffer.from('PK\u0003\u0004apk-de-teste'));
    const download = await ctx.http().get('/api/app/MAVIE-HGest.apk').expect(200);
    expect(download.headers['content-type']).toContain('application/vnd.android.package-archive');
    expect(download.headers['content-disposition']).toContain('MAVIE-HGest.apk');
    expect(download.headers['cache-control']).toBe('no-cache');
    const head = await ctx.http().head('/api/app/MAVIE-HGest.apk').expect(200);
    expect(head.headers['content-length']).toBe(String(Buffer.byteLength('PK\u0003\u0004apk-de-teste')));

    await ctx.http().get('/api/app/info').expect(401);
    const info = await ctx.http().get('/api/app/info').set(auth).expect(200);
    expect(info.body).toMatchObject({ available: true, path: '/api/app/MAVIE-HGest.apk' });
    for (const server of info.body.servers) {
      expect(server.download).toBe(`${server.server}/api/app/MAVIE-HGest.apk`);
      expect(server.downloadQr).toMatch(/^data:image\/png;base64,/);
    }
  });
});

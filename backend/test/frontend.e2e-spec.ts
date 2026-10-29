import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trustProxy } from '../src/app.setup';
import { createApp, TestContext } from './helpers';

describe('API a servir o painel (FRONTEND_DIR)', () => {
  let ctx: TestContext;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mavie-frontend-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>MAVIE-HGest</title><div id="app"></div>');
    writeFileSync(join(dir, 'assets', 'app-1234.js'), 'console.log(1)');
    process.env.FRONTEND_DIR = dir;
    ctx = await createApp();
  });

  afterAll(async () => {
    await ctx.app.close();
    delete process.env.FRONTEND_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('serve o index nas rotas do painel e do site, e os assets com cache longa', async () => {
    for (const path of ['/', '/reservas/12', '/h/hotel-mavie', '/configuracao?tab=site']) {
      const response = await ctx.http().get(path).expect(200);
      expect(response.text).toContain('<div id="app">');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    }
    const asset = await ctx.http().get('/assets/app-1234.js').expect(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    await ctx.http().get('/assets/nao-existe.js').expect(404);
    await ctx.http().get('/favicon.ico').expect(404);
  });

  it('a API continua a responder em JSON e nao cai no index', async () => {
    const health = await ctx.http().get('/api/health').expect(200);
    expect(health.headers['content-type']).toContain('application/json');
    const missing = await ctx.http().get('/api/nao-existe').expect(404);
    expect(missing.headers['content-type']).toContain('application/json');
    await ctx.http().post('/reservas').expect(404);
  });

  it('TRUST_PROXY aceita desligar, numero de saltos ou lista de enderecos', () => {
    expect(trustProxy(undefined)).toBe(1);
    expect(trustProxy('0')).toBe(false);
    expect(trustProxy('false')).toBe(false);
    expect(trustProxy('2')).toBe(2);
    expect(trustProxy('loopback')).toBe('loopback');
  });
});

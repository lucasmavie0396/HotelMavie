import { UserRole } from '@prisma/client';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { createPrismaClient, isSqlServer } from '../src/prisma/database';
import { createApp, createUser, login, TestContext } from './helpers';

(isSqlServer() ? describe : describe.skip)('Backup em SQL Server', () => {
  let ctx: TestContext;
  let dir: string;

  beforeAll(async () => {
    const probe = createPrismaClient();
    try {
      const [row] = await probe.$queryRawUnsafe<{ path: string }[]>("SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS NVARCHAR(400)) AS path");
      dir = join(row.path, `mavie-testes-${Date.now()}`);
    } finally {
      await probe.$disconnect();
    }
    process.env.BACKUP_DIR = dir;
    ctx = await createApp();
  });

  afterAll(async () => {
    await ctx.app.close();
    delete process.env.BACKUP_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('cria um .bak com BACKUP DATABASE, lista-o e deixa descarregar', async () => {
    const admin = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
    const created = await ctx.http().post('/api/backups').set(admin).expect(201);
    expect(created.body.name).toMatch(/^mavie-\d{8}-\d{6}\.bak$/);
    expect(created.body.size).toBeGreaterThan(100_000);

    const listed = await ctx.http().get('/api/backups').set(admin).expect(200);
    expect(listed.body.map((item: { name: string }) => item.name)).toContain(created.body.name);
    await ctx.http().get(`/api/backups/${created.body.name}`).set(admin).expect(200);
  });
});

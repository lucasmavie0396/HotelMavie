import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, login, PASSWORD, TestContext } from './helpers';

describe('Autenticacao e permissoes', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('recusa pedidos sem token e credenciais erradas', async () => {
    await ctx.http().get('/api/reservations').expect(401);
    const { email } = await createUser(ctx.prisma, UserRole.ADMIN, null);
    await ctx.http().post('/api/auth/login').send({ email, password: 'errada-123' }).expect(401);
  });

  it('roda o refresh token e revoga tudo se um token antigo for reutilizado', async () => {
    const { email } = await createUser(ctx.prisma, UserRole.ADMIN, null);
    const deviceA = await login(ctx, email);
    const deviceB = await login(ctx, email);

    const rotated = await ctx.http().post('/api/auth/refresh').send({ refreshToken: deviceA.refreshToken }).expect(200);
    await ctx.http().post('/api/auth/refresh').send({ refreshToken: deviceB.refreshToken }).expect(200);

    await ctx.http().post('/api/auth/refresh').send({ refreshToken: deviceA.refreshToken }).expect(401);
    await ctx.http().post('/api/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(200).then((r) => (rotated.body = r.body));

    await ctx.prisma.userSession.updateMany({ where: { user: { email } }, data: { rotatedAt: new Date(Date.now() - 5 * 60_000) } });
    await ctx.http().post('/api/auth/refresh').send({ refreshToken: deviceA.refreshToken }).expect(401);
    await ctx.http().post('/api/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
  });

  it('dois separadores a renovar com o mesmo token nao terminam a sessao', async () => {
    const { email } = await createUser(ctx.prisma, UserRole.ADMIN, null);
    const tab = await login(ctx, email);
    const [first, second] = await Promise.all([
      ctx.http().post('/api/auth/refresh').send({ refreshToken: tab.refreshToken }),
      ctx.http().post('/api/auth/refresh').send({ refreshToken: tab.refreshToken }),
    ]);
    const winner = [first, second].find((r) => r.status === 200)!;
    expect([first.status, second.status].sort()).toEqual([200, 401]);
    await ctx.http().post('/api/auth/refresh').send({ refreshToken: winner.body.refreshToken }).expect(200);
  });

  it('desativar um utilizador impede login e termina as sessoes', async () => {
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    const adminSession = await login(ctx, admin.email);
    const { hotel } = await createHotel(ctx.prisma);
    const staff = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const staffSession = await login(ctx, staff.email);

    await ctx.http().patch(`/api/users/${staff.user.id}`).set(adminSession.auth).send({ active: false }).expect(200);

    await ctx.http().post('/api/auth/refresh').send({ refreshToken: staffSession.refreshToken }).expect(401);
    await ctx.http().post('/api/auth/login').set('X-Forwarded-For', '10.200.0.1').send({ email: staff.email, password: PASSWORD }).expect(401);
  });

  it('rececao nao acede a areas de gestao nem cria utilizadores', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const staff = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const { auth } = await login(ctx, staff.email);

    await ctx.http().get('/api/users').set(auth).expect(403);
    await ctx.http().get('/api/purchases').set(auth).expect(403);
    await ctx.http().get(`/api/reports/summary?from=2026-01-01&to=2026-01-31`).set(auth).expect(403);
    await ctx.http().post('/api/tax-rates').set(auth).send({ name: 'X', rate: 5 }).expect(403);
    await ctx.http().get('/api/backups').set(auth).expect(403);
  });

  it('nunca devolve hashes de password ou sessoes', async () => {
    const { email } = await createUser(ctx.prisma, UserRole.ADMIN, null);
    const { auth } = await login(ctx, email);
    const me = await ctx.http().get('/api/auth/me').set(auth).expect(200);
    const users = await ctx.http().get('/api/users').set(auth).expect(200);
    for (const body of [me.body, ...users.body]) {
      expect(body).not.toHaveProperty('passwordHash');
      expect(body).not.toHaveProperty('sessions');
    }
  });

  it('limita tentativas de login', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await ctx
        .http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', '10.250.0.9')
        .send({ email: 'ninguem@teste.local', password: 'errada-123' });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  });
});

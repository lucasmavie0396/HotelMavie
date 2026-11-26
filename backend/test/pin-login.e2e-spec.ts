import { UserRole } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { createApp, createHotel, createUser, login, TestContext } from './helpers';

describe('Entrar no ecra tactil com codigo', () => {
  let ctx: TestContext;
  let admin: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    admin = (await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email)).auth;
  });

  afterAll(() => ctx.app.close());

  const address = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  const pin = (userId: number, value: string) => ctx.http().post('/api/auth/login/pin').set('X-Forwarded-For', address()).send({ userId, pin: value });

  it('o administrador define o codigo, o utilizador entra com ele e fica bloqueado apos 5 erros', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const waiter = await createUser(ctx.prisma, UserRole.CASHIER, hotel.id);
    const other = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const boss = await createUser(ctx.prisma, UserRole.ADMIN, hotel.id);

    await ctx.http().patch(`/api/users/${waiter.user.id}/pin`).set(admin).send({ pin: '12' }).expect(400);
    const set = await ctx.http().patch(`/api/users/${waiter.user.id}/pin`).set(admin).send({ pin: '4321' }).expect(200);
    expect(set.body).toMatchObject({ id: waiter.user.id, hasPin: true });
    expect(set.body).not.toHaveProperty('pinHash');
    await ctx.http().patch(`/api/users/${boss.user.id}/pin`).set(admin).send({ pin: '1111' }).expect(200);
    const receptionAuth = (await login(ctx, other.email)).auth;
    await ctx.http().patch(`/api/users/${other.user.id}/pin`).set(receptionAuth).send({ pin: '2222' }).expect(403);

    const users = await ctx.http().get('/api/auth/touch-users').expect(200);
    const ids = users.body.map((user: { id: number }) => user.id);
    expect(ids).toContain(waiter.user.id);
    expect(ids).not.toContain(other.user.id);
    expect(ids).not.toContain(boss.user.id);
    expect(users.body.find((user: { id: number }) => user.id === waiter.user.id)).toEqual({ id: waiter.user.id, name: waiter.user.name });

    await pin(boss.user.id, '1111').expect(401);
    await pin(waiter.user.id, '0000').expect(401);
    const session = await pin(waiter.user.id, '4321').expect(200);
    expect(session.body.user).toMatchObject({ id: waiter.user.id, role: 'CASHIER' });
    await ctx.http().get('/api/auth/me').set('Authorization', `Bearer ${session.body.accessToken}`).expect(200);

    for (let attempt = 1; attempt <= 4; attempt++) await pin(waiter.user.id, '9999').expect(401);
    const locked = await pin(waiter.user.id, '9999').expect(401);
    expect(locked.body.message).toContain('bloqueado');
    const blocked = await pin(waiter.user.id, '4321').expect(401);
    expect(blocked.body.message).toContain('Tente daqui a');

    const list = await ctx.http().get('/api/users').set(admin).expect(200);
    expect(list.body.find((user: { id: number }) => user.id === waiter.user.id).hasPin).toBe(true);
    await ctx.http().patch(`/api/users/${waiter.user.id}/pin`).set(admin).send({ pin: null }).expect(200);
    await pin(waiter.user.id, '4321').expect(401);
    expect((await ctx.http().get('/api/auth/touch-users').expect(200)).body.map((user: { id: number }) => user.id)).not.toContain(waiter.user.id);
  });
});

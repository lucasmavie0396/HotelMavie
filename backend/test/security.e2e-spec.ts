import { UserRole } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { currentStep, totpCode } from '../src/auth/totp';
import { MailInput, MailService } from '../src/mail/mail.service';
import { createApp, createHotel, createUser, login, PASSWORD, TestContext } from './helpers';

describe('Seguranca: recuperar password, 2FA e auditoria', () => {
  let ctx: TestContext;
  const address = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  const post = (path: string, body: object, headers: Record<string, string> = {}) =>
    ctx.http().post(path).set('X-Forwarded-For', address()).set(headers).send(body);

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('repoe a password com um link de uso unico e termina as sessoes abertas', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const { user, email } = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const session = await login(ctx, email);
    const sent: MailInput[] = [];
    const spy = jest.spyOn(ctx.app.get(MailService), 'queue').mockImplementation((input) => void sent.push(input));

    await post('/api/auth/forgot-password', { email: 'ninguem@teste.local' }).expect(200, { sent: true });
    expect(sent).toHaveLength(0);
    await post('/api/auth/forgot-password', { email: email.toUpperCase() }).expect(200, { sent: true });
    spy.mockRestore();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: email, kind: 'PASSWORD_RESET' });
    const token = /token=([A-Za-z0-9_-]+)/.exec(sent[0].html)![1];
    expect(await ctx.prisma.passwordReset.count({ where: { userId: user.id, tokenHash: token } })).toBe(0);

    await post('/api/auth/reset-password', { token, password: 'curta' }).expect(400);
    await post('/api/auth/reset-password', { token, password: 'Nova-Password-2026' }).expect(200);
    await post('/api/auth/reset-password', { token, password: 'Outra-Password-2026' }).expect(400);
    await post('/api/auth/refresh', { refreshToken: session.refreshToken }).expect(401);
    await post('/api/auth/login', { email, password: PASSWORD }).expect(401);
    await post('/api/auth/login', { email, password: 'Nova-Password-2026' }).expect(200);
  });

  it('2FA: ativa com codigo, exige codigo no login, recusa repeticao e aceita codigo de recuperacao uma vez', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const { user, email } = await createUser(ctx.prisma, UserRole.MANAGER, hotel.id);
    const { auth } = await login(ctx, email);

    const setup = await ctx.http().post('/api/auth/2fa/setup').set(auth).expect(200);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');
    expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);
    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.totpSecret).not.toContain(setup.body.secret);

    await ctx.http().post('/api/auth/2fa/enable').set(auth).send({ code: '000000' }).expect(400);
    const step = currentStep();
    const enabled = await ctx.http().post('/api/auth/2fa/enable').set(auth).send({ code: totpCode(setup.body.secret, step) }).expect(200);
    expect(enabled.body.recoveryCodes).toHaveLength(8);

    const first = await post('/api/auth/login', { email, password: PASSWORD }).expect(200);
    expect(first.body).toMatchObject({ twoFactorRequired: true });
    expect(first.body.accessToken).toBeUndefined();
    await ctx.http().get('/api/auth/me').set({ Authorization: `Bearer ${first.body.challenge}` }).expect(401);
    await post('/api/auth/login/2fa', { challenge: first.body.challenge, code: totpCode(setup.body.secret, step) }).expect(401);
    const next = totpCode(setup.body.secret, step + 1);
    const ok = await post('/api/auth/login/2fa', { challenge: first.body.challenge, code: next }).expect(200);
    expect(ok.body.accessToken).toBeDefined();
    await post('/api/auth/login/2fa', { challenge: first.body.challenge, code: next }).expect(401);

    const recovery = enabled.body.recoveryCodes[0];
    const second = await post('/api/auth/login', { email, password: PASSWORD }).expect(200);
    await post('/api/auth/login/2fa', { challenge: second.body.challenge, code: recovery }).expect(200);
    await post('/api/auth/login/2fa', { challenge: second.body.challenge, code: recovery }).expect(401);
    expect((await ctx.http().get('/api/auth/2fa').set(auth).expect(200)).body).toEqual({ enabled: true, recoveryCodesLeft: 7 });

    const admin = await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email);
    await ctx.http().post(`/api/users/${user.id}/2fa/reset`).set(auth).expect(403);
    const reset = await ctx.http().post(`/api/users/${user.id}/2fa/reset`).set(admin.auth).expect(200);
    expect(reset.body.totpEnabled).toBe(false);
    const plain = await post('/api/auth/login', { email, password: PASSWORD }).expect(200);
    expect(plain.body.accessToken).toBeDefined();

    const logs = await ctx.http().get('/api/audit-logs').query({ hotelId: hotel.id }).set(admin.auth).expect(200);
    expect(logs.body.map((log: { action: string }) => log.action)).toEqual(expect.arrayContaining(['AUTH_2FA_ENABLED', 'USER_2FA_RESET', 'AUTH_LOGIN_FAILED']));
  });

  it('regista alteracoes de preco e anulacoes e cada gestor so ve o seu hotel', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email);
    const rate = await ctx.prisma.taxRate.create({ data: { hotelId: hotel.id, name: 'Normal', rate: 23 } });
    const product = await ctx.prisma.product.create({ data: { hotelId: hotel.id, name: 'Cafe', price: 1, taxRateId: rate.id } });

    await ctx.http().patch(`/api/products/${product.id}`).set(manager.auth).send({ price: 1.2 }).expect(200);
    await ctx.http().patch(`/api/products/${product.id}`).set(manager.auth).send({ name: 'Cafe expresso' }).expect(200);
    const order = await ctx.http().post('/api/orders').set(manager.auth).send({ hotelId: hotel.id, outlet: 'BAR' }).expect(201);
    const added = await ctx.http().post(`/api/orders/${order.body.id}/items`).set(manager.auth).send({ productId: product.id, quantity: 2 }).expect(201);
    await ctx.http().post(`/api/orders/${order.body.id}/send`).set(manager.auth).expect(200);
    await ctx.http().post(`/api/orders/${order.body.id}/items/${added.body.items[0].id}/void`).set(manager.auth).send({ reason: 'Cliente desistiu' }).expect(200);

    const logs = await ctx.http().get('/api/audit-logs').set(manager.auth).expect(200);
    expect(logs.body.map((log: { action: string }) => log.action)).toEqual(['ORDER_ITEM_VOID', 'PRODUCT_PRICE']);
    expect(logs.body[1].summary).toContain('preco 1 -> 1.2');
    expect(logs.body[0].summary).toContain('Cliente desistiu');

    const other = await createHotel(ctx.prisma);
    const outsider = await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, other.hotel.id)).email);
    expect((await ctx.http().get('/api/audit-logs').set(outsider.auth).expect(200)).body).toHaveLength(0);
    const reception = await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email);
    await ctx.http().get('/api/audit-logs').set(reception.auth).expect(403);

    const admin = await login(ctx, (await createUser(ctx.prisma, UserRole.ADMIN, null)).email);
    expect((await ctx.http().get('/api/backups/status').set(admin.auth).expect(200)).body).toMatchObject({ enabled: false, keepDays: 14 });
  });
});

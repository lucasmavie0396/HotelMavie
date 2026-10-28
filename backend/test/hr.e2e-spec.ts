import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, day, login, TestContext } from './helpers';

describe('Recursos humanos', () => {
  let ctx: TestContext;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await createApp();
    const admin = await createUser(ctx.prisma, UserRole.ADMIN, null);
    auth = (await login(ctx, admin.email)).auth;
  });

  afterAll(() => ctx.app.close());

  async function employee(hotelId: number, extra: object = {}) {
    const response = await ctx.http()
      .post('/api/hr/employees')
      .set(auth)
      .send({ hotelId, fullName: 'Maria Rececao', jobTitle: 'Rececionista', startDate: day(-30), iban: 'PT50000201231234567890154', baseSalary: 1000, ...extra })
      .expect(201);
    return response.body;
  }

  it('rececao ve a equipa mas nao os dados sensiveis', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    await employee(hotel.id);
    const staff = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const staffAuth = (await login(ctx, staff.email)).auth;

    const list = await ctx.http().get('/api/hr/employees').set(staffAuth).expect(200);
    expect(list.body[0]).toMatchObject({ fullName: 'Maria Rececao', jobTitle: 'Rececionista' });
    expect(list.body[0]).not.toHaveProperty('iban');
    expect(list.body[0]).not.toHaveProperty('baseSalary');
    await ctx.http().post('/api/hr/employees').set(staffAuth).send({ fullName: 'X', jobTitle: 'Y', startDate: day(0) }).expect(403);
    await ctx.http().get(`/api/hr/monthly?month=${day(0).slice(0, 7)}`).set(staffAuth).expect(403);

    const full = await ctx.http().get(`/api/hr/employees?hotelId=${hotel.id}`).set(auth).expect(200);
    expect(full.body[0]).toMatchObject({ iban: 'PT50000201231234567890154', baseSalary: '1000' });
  });

  it('turnos validam sobreposicoes, incluindo turnos noturnos', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const worker = await employee(hotel.id);
    const shift = (body: object, date = day(3)) => ctx.http().post('/api/hr/shifts').set(auth).send({ employeeId: worker.id, date, ...body });

    await shift({ startTime: '23:00', endTime: '07:00', breakMinutes: 30 }).expect(201);
    await shift({ startTime: '06:00', endTime: '08:00' }, day(4)).expect(409);
    await shift({ startTime: '07:00', endTime: '15:00' }, day(4)).expect(201);
    await shift({ startTime: '22:00', endTime: '23:30' }, day(2)).expect(201);
    await shift({ startTime: '20:00', endTime: '00:30' }, day(2)).expect(409);
    await shift({ startTime: '06:00', endTime: '08:00' }).expect(201);
    await shift({ startTime: '15:00', endTime: '23:30' }).expect(409);
    await shift({ startTime: '25:00', endTime: '08:00' }).expect(400);
  });

  it('copia a escala de uma semana para outra so se o destino estiver vazio', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const worker = await employee(hotel.id);
    for (const offset of [7, 8, 9]) {
      await ctx.http().post('/api/hr/shifts').set(auth).send({ employeeId: worker.id, date: day(offset), startTime: '08:00', endTime: '16:00', breakMinutes: 60 }).expect(201);
    }
    const copy = await ctx.http().post('/api/hr/shifts/copy-week').set(auth).send({ hotelId: hotel.id, fromWeek: day(7), toWeek: day(14) }).expect(201);
    expect(copy.body.copied).toBe(3);
    await ctx.http().post('/api/hr/shifts/copy-week').set(auth).send({ hotelId: hotel.id, fromWeek: day(7), toWeek: day(14) }).expect(409);
    await ctx.http().post('/api/hr/shifts/copy-week').set(auth).send({ hotelId: hotel.id, fromWeek: day(7), toWeek: day(10) }).expect(400);
    const week = await ctx.http().get(`/api/hr/shifts?hotelId=${hotel.id}&from=${day(14)}&to=${day(20)}`).set(auth).expect(200);
    expect(week.body.map((s: { date: string }) => s.date.slice(0, 10))).toEqual([day(14), day(15), day(16)]);
  });

  it('picagem propria alterna entrada e saida; so gestores picam por outros', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const staff = await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id);
    const staffAuth = (await login(ctx, staff.email)).auth;
    await ctx.http().post('/api/hr/clock').set(staffAuth).send({}).expect(400);

    const mine = await employee(hotel.id, { userId: staff.user.id });
    const other = await employee(hotel.id, { fullName: 'Outro' });

    const clockIn = await ctx.http().post('/api/hr/clock').set(staffAuth).send({}).expect(200);
    expect(clockIn.body).toMatchObject({ employeeId: mine.id, clockOut: null, source: 'SELF' });
    expect((await ctx.http().get('/api/hr/clock').set(staffAuth).expect(200)).body.open.id).toBe(clockIn.body.id);
    const clockOut = await ctx.http().post('/api/hr/clock').set(staffAuth).send({}).expect(200);
    expect(clockOut.body.id).toBe(clockIn.body.id);
    expect(clockOut.body.clockOut).not.toBeNull();

    await ctx.http().post('/api/hr/clock').set(staffAuth).send({ employeeId: other.id }).expect(403);
    const byManager = await ctx.http().post('/api/hr/clock').set(auth).send({ employeeId: other.id }).expect(200);
    expect(byManager.body.source).toBe('MANAGER');

    const visible = await ctx.http().get(`/api/hr/time-entries?from=${day(-1)}&to=${day(1)}`).set(staffAuth).expect(200);
    expect(visible.body.every((entry: { employeeId: number }) => entry.employeeId === mine.id)).toBe(true);
  });

  it('picagens em simultaneo nao abrem duas entradas', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const worker = await employee(hotel.id);
    await Promise.all(Array.from({ length: 4 }, () => ctx.http().post('/api/hr/clock').set(auth).send({ employeeId: worker.id })));
    const entries = await ctx.prisma.timeEntry.findMany({ where: { employeeId: worker.id } });
    expect(entries).toHaveLength(2);
    expect(entries.filter((entry) => !entry.clockOut)).toHaveLength(0);
  });

  it('mapa mensal compara horas previstas e trabalhadas e marca correcoes', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const worker = await employee(hotel.id);
    const today = day(0);
    await ctx.http().post('/api/hr/shifts').set(auth).send({ employeeId: worker.id, date: today, startTime: '09:00', endTime: '17:00', breakMinutes: 60 }).expect(201);
    const entry = await ctx.prisma.timeEntry.create({
      data: { hotelId: hotel.id, employeeId: worker.id, clockIn: new Date(`${today}T09:00:00Z`), clockOut: new Date(`${today}T16:00:00Z`) },
    });
    await ctx.http()
      .patch(`/api/hr/time-entries/${entry.id}`)
      .set(auth)
      .send({ clockOut: new Date(`${today}T17:30:00Z`).toISOString(), notes: 'Esqueceu-se de picar a saida' })
      .expect(200);
    await ctx.http().patch(`/api/hr/time-entries/${entry.id}`).set(auth).send({ clockOut: new Date(`${today}T08:00:00Z`).toISOString(), notes: 'errado' }).expect(400);

    const report = await ctx.http().get(`/api/hr/monthly?hotelId=${hotel.id}&month=${today.slice(0, 7)}`).set(auth).expect(200);
    expect(report.body).toEqual([
      expect.objectContaining({ employeeId: worker.id, scheduledMinutes: 420, workedMinutes: 510, differenceMinutes: 90, workedDays: 1, editedEntries: 1, openEntries: 0 }),
    ]);
  });
});

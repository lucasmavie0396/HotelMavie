import { UserRole } from '@prisma/client';
import { createApp, createHotel, createUser, login, TestContext } from './helpers';

describe('Processamento salarial', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });

  afterAll(() => ctx.app.close());

  it('gera recibos com faltas do ponto, subsidios, abonos e fecha sem permitir alteracoes', async () => {
    const { hotel } = await createHotel(ctx.prisma);
    const manager = await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, hotel.id)).email);
    const reception = await login(ctx, (await createUser(ctx.prisma, UserRole.RECEPTION, hotel.id)).email);
    const employee = await ctx.prisma.employee.create({
      data: { hotelId: hotel.id, fullName: 'Ana Silva', jobTitle: 'Rececionista', startDate: new Date('2020-01-01'), baseSalary: 1000, weeklyHours: 40, irsRate: 10, taxId: '123456789' },
    });
    await ctx.prisma.employee.create({ data: { hotelId: hotel.id, fullName: 'Sem salario', jobTitle: 'Estagio', startDate: new Date('2020-01-01') } });
    await ctx.prisma.shift.createMany({
      data: [1, 2].map((day) => ({ hotelId: hotel.id, employeeId: employee.id, date: new Date(Date.UTC(2026, 5, day)), startTime: '09:00', endTime: '17:00' })),
    });
    await ctx.prisma.timeEntry.create({ data: { hotelId: hotel.id, employeeId: employee.id, clockIn: new Date('2026-06-01T08:00:00Z'), clockOut: new Date('2026-06-01T16:00:00Z') } });

    await ctx.http().get('/api/hr/payroll/settings').set(reception.auth).expect(403);
    const settings = await ctx.http().get('/api/hr/payroll/settings').query({ hotelId: hotel.id }).set(manager.auth).expect(200);
    expect(settings.body).toMatchObject({ employeeSsRate: 11, employerSsRate: 23.75, holidayPayMonth: 6 });

    const run = await ctx.http().post('/api/hr/payroll/runs').set(manager.auth).send({ hotelId: hotel.id, month: '2026-06' }).expect(201);
    await ctx.http().post('/api/hr/payroll/runs').set(manager.auth).send({ hotelId: hotel.id, month: '2026-06' }).expect(409);
    expect(run.body.payslips).toHaveLength(1);
    const slip = run.body.payslips[0];
    expect(slip).toMatchObject({ fullName: 'Ana Silva', scheduledHours: '16', workedHours: '8', absenceHours: '8', absenceDeduction: '46.15', holidayPay: '1000' });
    expect(slip.grossPay).toBe('1953.85');
    expect(slip.netPay).toBe('1543.54');

    const edited = await ctx.http()
      .patch(`/api/hr/payroll/payslips/${slip.id}`)
      .set(manager.auth)
      .send({ absenceHours: 0, extraLines: [{ label: 'Subsidio de refeicao', amount: 132, kind: 'EARNING', taxable: false }] })
      .expect(200);
    expect(edited.body).toMatchObject({ grossPay: '2132', ssBase: '2000', employeeSs: '220', irsWithholding: '200', netPay: '1712', employerSs: '475', manual: true });

    await ctx.http().post(`/api/hr/payroll/runs/${run.body.id}/recalculate`).set(manager.auth).expect(200);
    expect((await ctx.prisma.payslip.findUniqueOrThrow({ where: { id: slip.id } })).netPay.toString()).toBe('1712');

    const pdf = await ctx.http().get(`/api/hr/payroll/payslips/${slip.id}/pdf`).set(manager.auth).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    await ctx.http().get(`/api/hr/payroll/runs/${run.body.id}/pdf`).set(manager.auth).expect(200);

    await ctx.http().post(`/api/hr/payroll/runs/${run.body.id}/close`).set(manager.auth).expect(200);
    await ctx.http().patch(`/api/hr/payroll/payslips/${slip.id}`).set(manager.auth).send({ irsRate: 5 }).expect(409);
    await ctx.http().delete(`/api/hr/payroll/runs/${run.body.id}`).set(manager.auth).expect(409);
    const logs = await ctx.http().get('/api/audit-logs').query({ action: 'PAYROLL_CLOSE' }).set(manager.auth).expect(200);
    expect(logs.body[0].summary).toContain('Junho 2026');

    const other = await createHotel(ctx.prisma);
    const outsider = await login(ctx, (await createUser(ctx.prisma, UserRole.MANAGER, other.hotel.id)).email);
    await ctx.http().get(`/api/hr/payroll/runs/${run.body.id}`).set(outsider.auth).expect(404);
    await ctx.http().get(`/api/hr/payroll/payslips/${slip.id}/pdf`).set(outsider.auth).expect(404);
  });
});

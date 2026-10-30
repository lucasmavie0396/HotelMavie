import { computePayslip, hourlyRate, PayrollRates } from './payroll-calc';

const rates: PayrollRates = { employeeSsRate: 11, employerSsRate: 23.75, overtimeMultiplier: 1.25, subsidiesInTwelfths: false, holidayPayMonth: 6, christmasPayMonth: 12 };
const base = { year: 2026, baseSalary: 1000, weeklyHours: 40, irsRate: 10, startDate: new Date('2020-01-01'), absenceHours: 0, overtimeHours: 0 };

describe('calculo do recibo de vencimento', () => {
  it('valor hora pela formula (Rm x 12) / (52 x horas semanais)', () => {
    expect(hourlyRate(1000, 40).toString()).toBe('5.7692');
  });

  it('mes normal: TSU 11% e retencao de IRS sobre o bruto, encargo da empresa 23,75%', () => {
    const slip = computePayslip({ ...base, month: 3 }, rates);
    expect(slip.grossPay.toString()).toBe('1000');
    expect(slip.employeeSs.toString()).toBe('110');
    expect(slip.irsWithholding.toString()).toBe('100');
    expect(slip.netPay.toString()).toBe('790');
    expect(slip.employerSs.toString()).toBe('237.5');
    expect(slip.holidayPay.toString()).toBe('0');
  });

  it('faltas, horas extra, subsidio de ferias no mes configurado e abonos isentos', () => {
    const slip = computePayslip(
      {
        ...base,
        month: 6,
        absenceHours: 8,
        overtimeHours: 4,
        extraLines: [
          { label: 'Subsidio de refeicao', amount: 132, kind: 'EARNING', taxable: false },
          { label: 'Adiantamento', amount: 50, kind: 'DEDUCTION', taxable: false },
        ],
      },
      rates,
    );
    expect(slip.absenceDeduction.toString()).toBe('46.15');
    expect(slip.overtimePay.toString()).toBe('28.85');
    expect(slip.holidayPay.toString()).toBe('1000');
    expect(slip.grossPay.toString()).toBe('2114.7');
    expect(slip.ssBase.toString()).toBe('1982.7');
    expect(slip.employeeSs.toString()).toBe('218.1');
    expect(slip.irsWithholding.toString()).toBe('198.27');
    expect(slip.netPay.toString()).toBe('1648.33');
  });

  it('duodecimos todos os meses e proporcional no ano de admissao', () => {
    const twelfths = computePayslip({ ...base, month: 2 }, { ...rates, subsidiesInTwelfths: true });
    expect(twelfths.holidayPay.toString()).toBe('83.33');
    expect(twelfths.christmasPay.toString()).toBe('83.33');
    const newcomer = computePayslip({ ...base, month: 12, startDate: new Date('2026-07-10') }, rates);
    expect(newcomer.christmasPay.toString()).toBe('500');
  });
});

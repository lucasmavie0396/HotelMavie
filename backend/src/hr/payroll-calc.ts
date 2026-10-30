import { Prisma } from '@prisma/client';

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) => D(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface ExtraLine {
  label: string;
  amount: number;
  kind: 'EARNING' | 'DEDUCTION';
  taxable: boolean;
}

export interface PayrollRates {
  employeeSsRate: Prisma.Decimal.Value;
  employerSsRate: Prisma.Decimal.Value;
  overtimeMultiplier: Prisma.Decimal.Value;
  subsidiesInTwelfths: boolean;
  holidayPayMonth: number;
  christmasPayMonth: number;
}

export interface PayslipInput {
  year: number;
  month: number;
  baseSalary: Prisma.Decimal.Value;
  weeklyHours: Prisma.Decimal.Value;
  irsRate: Prisma.Decimal.Value;
  startDate: Date;
  absenceHours: Prisma.Decimal.Value;
  overtimeHours: Prisma.Decimal.Value;
  holidayPay?: Prisma.Decimal.Value;
  christmasPay?: Prisma.Decimal.Value;
  extraLines?: ExtraLine[];
}

export function hourlyRate(baseSalary: Prisma.Decimal.Value, weeklyHours: Prisma.Decimal.Value) {
  return D(baseSalary).mul(12).div(D(weeklyHours).mul(52)).toDecimalPlaces(4);
}

export function subsidyShare(input: { year: number; startDate: Date }) {
  const startYear = input.startDate.getUTCFullYear();
  if (startYear < input.year) return D(1);
  if (startYear > input.year) return D(0);
  return D(12 - input.startDate.getUTCMonth()).div(12);
}

export function defaultSubsidies(input: { year: number; month: number; baseSalary: Prisma.Decimal.Value; startDate: Date }, rates: PayrollRates) {
  const base = D(input.baseSalary);
  if (rates.subsidiesInTwelfths) {
    const twelfth = money(base.div(12));
    return { holidayPay: twelfth, christmasPay: twelfth };
  }
  const share = subsidyShare(input);
  return {
    holidayPay: input.month === rates.holidayPayMonth ? money(base.mul(share)) : D(0),
    christmasPay: input.month === rates.christmasPayMonth ? money(base.mul(share)) : D(0),
  };
}

export function computePayslip(input: PayslipInput, rates: PayrollRates) {
  const base = money(input.baseSalary);
  const hourly = hourlyRate(base, input.weeklyHours);
  const defaults = defaultSubsidies(input, rates);
  const holidayPay = money(input.holidayPay ?? defaults.holidayPay);
  const christmasPay = money(input.christmasPay ?? defaults.christmasPay);
  const absenceHours = D(input.absenceHours).toDecimalPlaces(2);
  const overtimeHours = D(input.overtimeHours).toDecimalPlaces(2);
  const absenceDeduction = Prisma.Decimal.min(money(absenceHours.mul(hourly)), base);
  const overtimePay = money(overtimeHours.mul(hourly).mul(rates.overtimeMultiplier));
  const lines = input.extraLines ?? [];
  const sum = (filter: (line: ExtraLine) => boolean) => lines.filter(filter).reduce((total, line) => total.add(money(line.amount)), D(0));
  const otherEarnings = sum((line) => line.kind === 'EARNING');
  const exemptEarnings = sum((line) => line.kind === 'EARNING' && !line.taxable);
  const otherDeductions = sum((line) => line.kind === 'DEDUCTION');
  const grossPay = base.sub(absenceDeduction).add(overtimePay).add(holidayPay).add(christmasPay).add(otherEarnings);
  const ssBase = grossPay.sub(exemptEarnings);
  const employeeSs = money(ssBase.mul(rates.employeeSsRate).div(100));
  const irsWithholding = money(ssBase.mul(input.irsRate).div(100));
  const netPay = grossPay.sub(employeeSs).sub(irsWithholding).sub(otherDeductions);
  const employerSs = money(ssBase.mul(rates.employerSsRate).div(100));
  return {
    baseSalary: base,
    hourlyRate: hourly,
    absenceHours,
    absenceDeduction,
    overtimeHours,
    overtimePay,
    holidayPay,
    christmasPay,
    otherEarnings,
    grossPay,
    ssBase,
    employeeSsRate: D(rates.employeeSsRate),
    employeeSs,
    irsRate: D(input.irsRate),
    irsWithholding,
    otherDeductions,
    netPay,
    employerSsRate: D(rates.employerSsRate),
    employerSs,
  };
}

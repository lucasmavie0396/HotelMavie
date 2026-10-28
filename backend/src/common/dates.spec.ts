import { BadRequestException } from '@nestjs/common';
import { addDays, assertStayRange, nightsBetween, parseDate } from './dates';

describe('dates', () => {
  it('conta noites entre datas', () => {
    expect(nightsBetween(parseDate('2026-03-28'), parseDate('2026-03-31'))).toBe(3);
  });

  it('nao e afetado pela mudanca de hora', () => {
    expect(nightsBetween(parseDate('2026-03-28'), parseDate('2026-03-30'))).toBe(2);
    expect(addDays(parseDate('2026-10-24'), 2).toISOString().slice(0, 10)).toBe('2026-10-26');
  });

  it('rejeita estadias sem noites ou demasiado longas', () => {
    expect(() => assertStayRange(parseDate('2026-01-02'), parseDate('2026-01-02'))).toThrow(BadRequestException);
    expect(() => assertStayRange(parseDate('2026-01-03'), parseDate('2026-01-02'))).toThrow(BadRequestException);
    expect(() => assertStayRange(parseDate('2026-01-01'), parseDate('2027-01-03'))).toThrow(BadRequestException);
    expect(assertStayRange(parseDate('2026-01-01'), parseDate('2026-01-02'))).toBe(1);
  });

  it('rejeita datas invalidas', () => {
    expect(() => parseDate('2026-13-45')).toThrow(BadRequestException);
  });
});

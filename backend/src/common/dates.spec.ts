import { BadRequestException } from '@nestjs/common';
import { addDays, assertStayRange, localDate, localDayStart, localDayWindow, nightsBetween, parseDate } from './dates';

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

describe('dias no fuso do hotel', () => {
  const previous = process.env.AT_TIMEZONE;
  afterEach(() => {
    if (previous === undefined) delete process.env.AT_TIMEZONE;
    else process.env.AT_TIMEZONE = previous;
  });

  it('em Maputo o dia comeca as 22:00 UTC do dia anterior', () => {
    process.env.AT_TIMEZONE = 'Africa/Maputo';
    expect(localDayStart('2026-11-27').toISOString()).toBe('2026-11-26T22:00:00.000Z');
    expect(localDate(new Date('2026-11-26T23:30:00Z'))).toBe('2026-11-27');
    expect(localDate(new Date('2026-11-26T21:59:59Z'))).toBe('2026-11-26');
    expect(localDayWindow('2026-11-01', '2026-11-30')).toEqual({
      gte: new Date('2026-10-31T22:00:00.000Z'),
      lt: new Date('2026-11-30T22:00:00.000Z'),
    });
  });

  it('em Lisboa respeita a hora de verao', () => {
    process.env.AT_TIMEZONE = 'Europe/Lisbon';
    expect(localDayStart('2026-01-15').toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(localDayStart('2026-07-01').toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(localDayStart('2026-03-29').toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(localDayStart('2026-10-25').toISOString()).toBe('2026-10-24T23:00:00.000Z');
  });
});

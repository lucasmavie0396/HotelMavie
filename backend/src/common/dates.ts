import { BadRequestException } from '@nestjs/common';

const DAY_MS = 86_400_000;

export function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Data invalida: ${value}`);
  }
  return date;
}

export function businessTimeZone() {
  return process.env.AT_TIMEZONE || 'Europe/Lisbon';
}

function zoneParts(instant: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: businessTimeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>;
}

export function localDate(instant: Date) {
  const parts = zoneParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zoneOffset(instant: Date) {
  const parts = zoneParts(instant);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function localDayStart(day: string | Date) {
  const midnight = typeof day === 'string' ? parseDate(day) : day;
  const guess = new Date(midnight.getTime() - zoneOffset(midnight));
  return new Date(midnight.getTime() - zoneOffset(guess));
}

export function localDayWindow(from?: string, to?: string) {
  return {
    ...(from ? { gte: localDayStart(from) } : {}),
    ...(to ? { lt: localDayStart(addDays(parseDate(to), 1)) } : {}),
  };
}

export function todayUtc() {
  return parseDate(localDate(new Date()));
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function nightsBetween(checkIn: Date, checkOut: Date) {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
}

export function assertStayRange(checkIn: Date, checkOut: Date) {
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) {
    throw new BadRequestException('A data de saida tem de ser posterior a data de entrada');
  }
  if (nights > 365) {
    throw new BadRequestException('A estadia nao pode exceder 365 noites');
  }
  return nights;
}

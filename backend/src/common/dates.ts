import { BadRequestException } from '@nestjs/common';

const DAY_MS = 86_400_000;

export function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Data invalida: ${value}`);
  }
  return date;
}

export function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
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

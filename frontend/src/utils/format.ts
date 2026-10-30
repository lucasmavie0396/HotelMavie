import { localeTag, translated } from '@/i18n';
import type { ChargeType, InvoiceType, PaymentMethod, ReservationSource, ReservationStatus, RoomStatus } from '@/types';

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: string | number, currency = import.meta.env.VITE_CURRENCY || 'EUR') {
  const key = `${localeTag()}:${currency}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(localeTag(), { style: 'currency', currency });
    formatters.set(key, formatter);
  }
  return formatter.format(Number(value));
}

export function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return toIsoDate(new Date(year, month - 1, day + days));
}

export function todayIso() {
  return toIsoDate(new Date());
}

export const ROOM_STATUSES: RoomStatus[] = ['AVAILABLE', 'OCCUPIED', 'CLEANING', 'MAINTENANCE'];

export const ROOM_STATUS_LABELS = translated('labels.roomStatus', ROOM_STATUSES);

export const ROOM_STATUS_CLASSES: Record<RoomStatus, string> = {
  AVAILABLE: 'bg-emerald-100 text-emerald-800',
  OCCUPIED: 'bg-rose-100 text-rose-800',
  CLEANING: 'bg-amber-100 text-amber-800',
  MAINTENANCE: 'bg-slate-200 text-slate-700',
};

export const RESERVATION_STATUSES: ReservationStatus[] = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
];

export const RESERVATION_STATUS_LABELS = translated('labels.reservationStatus', RESERVATION_STATUSES);

export const RESERVATION_STATUS_CLASSES: Record<ReservationStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-sky-100 text-sky-800',
  CHECKED_IN: 'bg-emerald-100 text-emerald-800',
  CHECKED_OUT: 'bg-slate-200 text-slate-700',
  CANCELLED: 'bg-rose-100 text-rose-800',
  NO_SHOW: 'bg-rose-100 text-rose-800',
};

export const RESERVATION_SOURCE_LABELS = translated<ReservationSource>('labels.reservationSource', ['DESK', 'PHONE', 'EMAIL', 'ONLINE']);

export const PAYMENT_METHOD_LABELS = translated<PaymentMethod>('labels.paymentMethod', ['CASH', 'CARD', 'TRANSFER', 'MOBILE', 'OTHER']);

export const INVOICE_TYPE_LABELS = translated<InvoiceType>('labels.invoiceType', ['INVOICE', 'INVOICE_RECEIPT', 'CREDIT_NOTE', 'RECEIPT']);

export const CHARGE_TYPE_LABELS = translated<ChargeType>('labels.chargeType', ['ACCOMMODATION', 'RESTAURANT', 'BAR', 'EXTRA']);

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' });
}

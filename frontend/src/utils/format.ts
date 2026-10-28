import type { ChargeType, InvoiceType, PaymentMethod, ReservationSource, ReservationStatus, RoomStatus } from '@/types';

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: string | number, currency = import.meta.env.VITE_CURRENCY || 'EUR') {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('pt-PT', { style: 'currency', currency });
    formatters.set(currency, formatter);
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

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  AVAILABLE: 'Disponivel',
  OCCUPIED: 'Ocupado',
  CLEANING: 'Limpeza',
  MAINTENANCE: 'Manutencao',
};

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

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmada',
  CHECKED_IN: 'Em casa',
  CHECKED_OUT: 'Saiu',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No-show',
};

export const RESERVATION_STATUS_CLASSES: Record<ReservationStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-sky-100 text-sky-800',
  CHECKED_IN: 'bg-emerald-100 text-emerald-800',
  CHECKED_OUT: 'bg-slate-200 text-slate-700',
  CANCELLED: 'bg-rose-100 text-rose-800',
  NO_SHOW: 'bg-rose-100 text-rose-800',
};

export const RESERVATION_SOURCE_LABELS: Record<ReservationSource, string> = {
  DESK: 'Balcao',
  PHONE: 'Telefone',
  EMAIL: 'Email',
  ONLINE: 'Online',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Numerario',
  CARD: 'Cartao',
  TRANSFER: 'Transferencia',
  MOBILE: 'Pagamento movel',
  OTHER: 'Outro',
};

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  INVOICE: 'Fatura',
  INVOICE_RECEIPT: 'Fatura-recibo',
  CREDIT_NOTE: 'Nota de credito',
  RECEIPT: 'Recibo',
};

export const CHARGE_TYPE_LABELS: Record<ChargeType, string> = {
  ACCOMMODATION: 'Alojamento',
  RESTAURANT: 'Restaurante',
  BAR: 'Bar',
  EXTRA: 'Extra',
};

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
}

import { api } from '@/services/api';
import type { Reservation } from '@/types';
import { todayIso } from '@/utils/format';

export type ReservationAction = 'confirm' | 'check-in' | 'check-out' | 'cancel' | 'no-show';

export const ACTION_LABELS: Record<ReservationAction, string> = {
  confirm: 'Confirmar',
  'check-in': 'Check-in',
  'check-out': 'Check-out',
  cancel: 'Cancelar',
  'no-show': 'No-show',
};

const CONFIRM_MESSAGES: Partial<Record<ReservationAction, string>> = {
  cancel: 'Cancelar esta reserva?',
  'no-show': 'Marcar esta reserva como no-show?',
  'check-out': 'Fazer check-out deste hospede?',
};

export function availableActions(reservation: Pick<Reservation, 'status' | 'checkIn' | 'checkOut'>) {
  const today = todayIso();
  const started = reservation.checkIn.slice(0, 10) <= today;
  const actions: ReservationAction[] = [];
  if (reservation.status === 'PENDING') {
    actions.push('confirm');
  }
  if (['PENDING', 'CONFIRMED'].includes(reservation.status)) {
    if (started && reservation.checkOut.slice(0, 10) > today) {
      actions.push('check-in');
    }
    actions.push('cancel');
    if (started) {
      actions.push('no-show');
    }
  }
  if (reservation.status === 'CHECKED_IN') {
    actions.push('check-out');
  }
  return actions;
}

export async function runReservationAction(id: number, action: ReservationAction) {
  const message = CONFIRM_MESSAGES[action];
  if (message && !window.confirm(message)) {
    return null;
  }
  const { data } = await api.post<Reservation>(`/reservations/${id}/${action}`);
  return data;
}

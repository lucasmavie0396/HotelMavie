import { computed, type Ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import type { CashRegister } from '@/types';

export function useOwnCash(registers: Ref<CashRegister[]>) {
  const auth = useAuthStore();
  return computed(() => registers.value.some((register) => register.sessions.some((session) => session.openedById === auth.user?.id)));
}

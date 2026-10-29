import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { PaymentType } from '@/types';

export const usePaymentTypesStore = defineStore('paymentTypes', () => {
  const all = ref<PaymentType[]>([]);
  const loadedFor = ref<number | null>(null);

  const active = computed(() => all.value.filter((type) => type.active));

  async function load(force = false) {
    const hotels = useHotelsStore();
    if (!hotels.selectedId || (!force && loadedFor.value === hotels.selectedId)) return;
    all.value = (await api.get<PaymentType[]>('/payment-types', { params: { hotelId: hotels.selectedId } })).data;
    loadedFor.value = hotels.selectedId;
  }

  function byId(id: number | null | undefined) {
    return all.value.find((type) => type.id === id) ?? null;
  }

  return { all, active, load, byId };
});

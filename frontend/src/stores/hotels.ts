import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import type { Hotel } from '@/types';

export const useHotelsStore = defineStore('hotels', () => {
  const hotels = ref<Hotel[]>([]);
  const selectedId = ref<number | null>(null);
  const loaded = ref(false);
  const loadError = ref('');
  let loading: Promise<void> | null = null;

  const selected = computed(() => hotels.value.find((hotel) => hotel.id === selectedId.value) ?? null);
  const currency = computed(() => selected.value?.currency ?? 'EUR');

  async function load(force = false) {
    if (hotels.value.length && !force) {
      return;
    }
    loading ??= api
      .get<Hotel[]>('/hotels')
      .then(({ data }) => {
        hotels.value = data;
        loaded.value = true;
        loadError.value = '';
        const auth = useAuthStore();
        if (!data.some((hotel) => hotel.id === selectedId.value)) {
          selectedId.value = auth.user?.hotelId ?? data[0]?.id ?? null;
        }
      })
      .catch((e) => {
        loadError.value = errorMessage(e);
      })
      .finally(() => {
        loading = null;
      });
    await loading;
  }

  function currencyOf(hotelId: number) {
    return hotels.value.find((hotel) => hotel.id === hotelId)?.currency ?? 'EUR';
  }

  function nameOf(hotelId: number) {
    return hotels.value.find((hotel) => hotel.id === hotelId)?.name ?? '';
  }

  function reset() {
    hotels.value = [];
    selectedId.value = null;
    loaded.value = false;
  }

  return { hotels, selectedId, loaded, loadError, selected, currency, load, currencyOf, nameOf, reset };
});

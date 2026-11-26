import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';

export interface LicenseStatus {
  state: 'VALID' | 'EXPIRING' | 'GRACE' | 'TRIAL' | 'EXPIRED' | 'MISSING' | 'INVALID' | 'CLOCK';
  blocked: boolean;
  message: string;
  name: string | null;
  nuit: string | null;
  validUntil: string | null;
  daysLeft: number | null;
  trialUntil: string | null;
  unlockRequest: string | null;
}

export const useLicenseStore = defineStore('license', () => {
  const status = ref<LicenseStatus | null>(null);
  let loadedAt = 0;

  async function load(force = false) {
    const hotels = useHotelsStore();
    if (!hotels.selectedId) return;
    if (!force && Date.now() - loadedAt < 5 * 60_000) return;
    try {
      status.value = (await api.get<LicenseStatus>('/license', { params: { hotelId: hotels.selectedId } })).data;
      loadedAt = Date.now();
    } catch {
      return;
    }
  }

  return { status, load };
});

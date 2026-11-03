<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import StatusBadge from '@/components/StatusBadge.vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Reservation, ReservationGroup } from '@/types';
import { formatMoney } from '@/utils/format';

const props = defineProps<{ reservation: Reservation }>();
const emit = defineEmits<{ updated: [] }>();

const { t } = useI18n();
const hotels = useHotelsStore();
const group = ref<ReservationGroup | null>(null);
const error = ref('');
const busy = ref(false);

const total = computed(() => group.value?.reservations.reduce((sum, item) => sum + Number(item.totalAmount), 0) ?? 0);
const pending = computed(() => group.value?.reservations.some((item) => item.status === 'PENDING') ?? false);
const open = computed(() => group.value?.reservations.some((item) => ['PENDING', 'CONFIRMED'].includes(item.status)) ?? false);

async function load() {
  group.value = null;
  if (!props.reservation.groupId) return;
  try {
    group.value = (await api.get<ReservationGroup>(`/reservation-groups/${props.reservation.groupId}`)).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: 'confirm' | 'cancel') {
  if (!group.value) return;
  if (action === 'cancel' && !window.confirm(t('group.cancelConfirm', { n: group.value.reservations.length }))) return;
  busy.value = true;
  error.value = '';
  try {
    group.value = (await api.post<ReservationGroup>(`/reservation-groups/${group.value.id}/${action}`)).data;
    emit('updated');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

watch(() => [props.reservation.groupId, props.reservation.status], load, { immediate: true });
</script>

<template>
  <div v-if="group" class="card space-y-3 text-sm">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold">
        {{ group.kind === 'CORPORATE' ? t('group.corporateTitle', { code: group.code }) : t('group.title', { code: group.code }) }}
      </h2>
      <div class="flex gap-2">
        <button v-if="pending" class="btn" type="button" :disabled="busy" @click="run('confirm')">{{ t('group.confirmAll') }}</button>
        <button v-if="open" class="btn-secondary" type="button" :disabled="busy" @click="run('cancel')">{{ t('group.cancelAll') }}</button>
      </div>
    </div>
    <div v-if="group.kind === 'CORPORATE'" class="grid gap-x-6 gap-y-1 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
      <p><span class="text-slate-500">{{ t('group.company') }}</span> <span class="font-medium">{{ group.companyName }}</span></p>
      <p><span class="text-slate-500">{{ t('group.taxId') }}</span> {{ group.companyTaxId }}</p>
      <p v-if="group.companyAddress" class="sm:col-span-2"><span class="text-slate-500">{{ t('group.address') }}</span> {{ group.companyAddress }}</p>
      <p v-if="group.contactName"><span class="text-slate-500">{{ t('group.contact') }}</span> {{ group.contactName }}</p>
      <p v-if="group.companyEmail || group.companyPhone">{{ [group.companyEmail, group.companyPhone].filter(Boolean).join(' · ') }}</p>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-left">
        <thead class="text-slate-500">
          <tr>
            <th class="py-1 pr-3">{{ t('reservations.code') }}</th>
            <th class="py-1 pr-3">{{ t('calendar.room') }}</th>
            <th class="py-1 pr-3">{{ t('reservations.guest') }}</th>
            <th class="py-1 pr-3">{{ t('group.people') }}</th>
            <th class="py-1 pr-3">{{ t('common.total') }}</th>
            <th class="py-1">{{ t('common.status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in group.reservations" :key="item.id" class="border-t border-slate-100" :class="item.id === reservation.id ? 'bg-indigo-50' : ''">
            <td class="py-1.5 pr-3">
              <RouterLink :to="{ name: 'reservation', params: { id: item.id } }" class="text-indigo-600 hover:underline">{{ item.code }}</RouterLink>
            </td>
            <td class="py-1.5 pr-3">{{ item.room.number }} <span class="text-slate-500">{{ item.room.type }}</span></td>
            <td class="py-1.5 pr-3">{{ item.guest.firstName }} {{ item.guest.lastName }}</td>
            <td class="py-1.5 pr-3">{{ item.adults + item.children }}</td>
            <td class="py-1.5 pr-3">{{ formatMoney(item.totalAmount, hotels.currency) }}</td>
            <td class="py-1.5"><StatusBadge :status="item.status" /></td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t border-slate-200 font-semibold">
            <td class="py-1.5" colspan="4">{{ t('group.rooms', group.reservations.length) }}</td>
            <td class="py-1.5" colspan="2">{{ formatMoney(total, hotels.currency) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p v-if="error" class="text-rose-600">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import type { Reservation } from '@/types';

const props = defineProps<{ reservation: Reservation }>();

const { t } = useI18n();
const form = reactive({ blocked: false, limit: '' as string | number });
const error = ref('');
const notice = ref('');
const busy = ref(false);

watch(
  () => props.reservation,
  (value) => Object.assign(form, { blocked: value.roomServiceBlocked, limit: value.roomServiceLimit === null ? '' : Number(value.roomServiceLimit) }),
  { immediate: true },
);

async function save() {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.patch(`/reservations/${props.reservation.id}/room-service`, {
      blocked: form.blocked,
      limit: form.limit === '' || form.limit === null ? null : Number(form.limit),
    });
    notice.value = t('reservation.roomServiceSaved');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card space-y-3" data-testid="room-service-panel" @submit.prevent="save">
    <h2 class="font-semibold">{{ t('reservation.roomService') }}</h2>
    <p class="text-sm text-slate-500">{{ t('reservation.roomServiceHint') }}</p>
    <div class="flex flex-wrap items-end gap-4">
      <label class="flex min-h-11 items-center gap-2 text-sm"><input v-model="form.blocked" type="checkbox" />{{ t('reservation.roomServiceBlocked') }}</label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('reservation.roomServiceLimit') }}</span>
        <input v-model="form.limit" class="input w-40" type="number" min="0" step="0.01" inputmode="decimal" :placeholder="t('reservation.noLimit')" />
      </label>
      <button class="btn" type="submit" :disabled="busy">{{ t('common.save') }}</button>
    </div>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>
  </form>
</template>

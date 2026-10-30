<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { DOCUMENT_TYPES, type Companion, type Reservation } from '@/types';
import { formatDate } from '@/utils/format';

const props = defineProps<{ reservation: Reservation }>();
const emit = defineEmits<{ updated: [reservation: Reservation] }>();

const { t } = useI18n();
const error = ref('');
const busy = ref(false);
const editingId = ref<number | 'new' | null>(null);

function emptyForm() {
  return { firstName: '', lastName: props.reservation.guest.lastName, isChild: false, birthDate: '', nationality: props.reservation.guest.nationality ?? '', documentType: 'BI', documentNumber: '' };
}
const form = reactive(emptyForm());

const total = computed(() => props.reservation.adults + props.reservation.children);
const max = computed(() => Math.max(total.value - 1, 0));
const missing = computed(() => max.value - props.reservation.companions.length);
const editable = computed(() => !['CANCELLED', 'NO_SHOW'].includes(props.reservation.status));

function startNew() {
  Object.assign(form, emptyForm());
  editingId.value = 'new';
}

function startEdit(companion: Companion) {
  Object.assign(form, {
    firstName: companion.firstName,
    lastName: companion.lastName,
    isChild: companion.isChild,
    birthDate: companion.birthDate?.slice(0, 10) ?? '',
    nationality: companion.nationality ?? '',
    documentType: companion.documentType ?? 'BI',
    documentNumber: companion.documentNumber ?? '',
  });
  editingId.value = companion.id;
}

async function run(action: () => Promise<{ data: Reservation }>) {
  busy.value = true;
  error.value = '';
  try {
    emit('updated', (await action()).data);
    editingId.value = null;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function payload() {
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    isChild: form.isChild,
    birthDate: form.birthDate || undefined,
    nationality: form.nationality.trim() || undefined,
    documentType: form.documentNumber.trim() ? form.documentType : undefined,
    documentNumber: form.documentNumber.trim() || undefined,
  };
}

const save = () =>
  run(() =>
    editingId.value === 'new'
      ? api.post<Reservation>(`/reservations/${props.reservation.id}/companions`, payload())
      : api.patch<Reservation>(`/reservations/${props.reservation.id}/companions/${editingId.value}`, payload()),
  );

const remove = (companion: Companion) => {
  if (!window.confirm(t('companions.confirmRemove', { name: `${companion.firstName} ${companion.lastName}` }))) return;
  return run(() => api.delete<Reservation>(`/reservations/${props.reservation.id}/companions/${companion.id}`));
};
</script>

<template>
  <div v-if="max > 0 || reservation.companions.length" class="card space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold">
        {{ t('companions.title') }}
        <span class="text-sm font-normal text-slate-500">{{ t('companions.count', { count: reservation.companions.length, max }) }}</span>
        <span v-if="missing > 0" class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{{ t('companions.missing', { n: missing }) }}</span>
      </h2>
      <button v-if="editable && reservation.companions.length < max && editingId !== 'new'" class="btn-secondary px-3 py-1 text-xs" type="button" @click="startNew">
        {{ t('companions.add') }}
      </button>
    </div>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <table v-if="reservation.companions.length" class="w-full text-left text-sm">
      <thead class="text-xs text-slate-500 uppercase">
        <tr><th class="py-1.5">{{ t('common.name') }}</th><th class="py-1.5">{{ t('guest.birthDate') }}</th><th class="py-1.5">{{ t('guest.nationality') }}</th><th class="py-1.5">{{ t('guest.document') }}</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="companion in reservation.companions" :key="companion.id" class="border-t border-slate-100">
          <td class="py-1.5">
            {{ companion.firstName }} {{ companion.lastName }}
            <span v-if="companion.isChild" class="ml-1 rounded bg-sky-100 px-1.5 text-xs text-sky-800">{{ t('companions.child') }}</span>
          </td>
          <td class="py-1.5">{{ companion.birthDate ? formatDate(companion.birthDate) : '-' }}</td>
          <td class="py-1.5">{{ companion.nationality ?? '-' }}</td>
          <td class="py-1.5">{{ [companion.documentType, companion.documentNumber].filter(Boolean).join(' ') || '-' }}</td>
          <td class="space-x-3 py-1.5 text-right text-xs whitespace-nowrap">
            <template v-if="editable">
              <button class="text-indigo-600 hover:underline" type="button" @click="startEdit(companion)">{{ t('common.edit') }}</button>
              <button class="text-rose-600 hover:underline" type="button" :disabled="busy" @click="remove(companion)">{{ t('common.remove') }}</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="editingId === null" class="text-sm text-slate-500">{{ t('companions.empty') }}</p>

    <form v-if="editingId !== null" class="grid gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100 sm:grid-cols-4" @submit.prevent="save">
      <p class="text-xs font-semibold text-slate-600 sm:col-span-4">{{ editingId === 'new' ? t('companions.new') : t('companions.edit') }}</p>
      <input v-model="form.firstName" class="input" :placeholder="t('guest.firstName')" maxlength="100" required />
      <input v-model="form.lastName" class="input" :placeholder="t('guest.lastName')" maxlength="100" required />
      <input v-model="form.birthDate" class="input" type="date" :aria-label="t('guest.birthDate')" :title="t('guest.birthDate')" />
      <input v-model="form.nationality" class="input" :placeholder="t('guest.nationality')" maxlength="60" />
      <select v-model="form.documentType" class="input" :aria-label="t('guest.documentType')">
        <option v-for="type in DOCUMENT_TYPES" :key="type" :value="type">{{ type }}</option>
      </select>
      <input v-model="form.documentNumber" class="input" :placeholder="t('guest.documentNumber')" maxlength="50" />
      <label class="flex items-center gap-2 text-sm"><input v-model="form.isChild" type="checkbox" />{{ t('companions.childLabel') }}</label>
      <div class="flex justify-end gap-2">
        <button class="btn-secondary px-3 py-1.5 text-xs" type="button" @click="editingId = null">{{ t('common.cancel') }}</button>
        <button class="btn px-3 py-1.5 text-xs" type="submit" :disabled="busy">{{ t('common.save') }}</button>
      </div>
    </form>
  </div>
</template>

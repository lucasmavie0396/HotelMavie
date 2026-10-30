<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Guest } from '@/types';

const props = defineProps<{ guest?: Guest | null }>();
const emit = defineEmits<{ saved: [guest: Guest]; cancel: [] }>();

const { t } = useI18n();
const hotels = useHotelsStore();
const error = ref('');
const saving = ref(false);

const FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'documentType',
  'documentNumber',
  'nationality',
  'birthDate',
  'taxId',
  'address',
  'notes',
] as const;

type GuestFields = Record<(typeof FIELDS)[number], string>;

function emptyForm(): GuestFields {
  return Object.fromEntries(FIELDS.map((field) => [field, ''])) as GuestFields;
}

const form = reactive<GuestFields>(emptyForm());

watch(
  () => props.guest,
  (guest) => {
    Object.assign(form, emptyForm());
    if (guest) {
      for (const field of FIELDS) {
        form[field] = field === 'birthDate' ? (guest.birthDate?.slice(0, 10) ?? '') : (guest[field] ?? '');
      }
    }
  },
  { immediate: true },
);

async function submit() {
  saving.value = true;
  error.value = '';
  const payload = Object.fromEntries(
    FIELDS.map((field) => [field, form[field].trim() || (props.guest ? null : undefined)]),
  );
  try {
    const { data } = props.guest
      ? await api.patch<Guest>(`/guests/${props.guest.id}`, payload)
      : await api.post<Guest>('/guests', { ...payload, hotelId: hotels.selectedId });
    emit('saved', data);
    if (!props.guest) {
      Object.assign(form, emptyForm());
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="submit">
    <input v-model="form.firstName" class="input" :placeholder="t('guest.firstName')" required />
    <input v-model="form.lastName" class="input" :placeholder="t('guest.lastName')" required />
    <input v-model="form.email" class="input" type="email" :placeholder="t('common.email')" />
    <input v-model="form.phone" class="input" :placeholder="t('common.phone')" />
    <input v-model="form.documentType" class="input" :placeholder="t('guest.documentType')" />
    <input v-model="form.documentNumber" class="input" :placeholder="t('guest.documentNumber')" />
    <input v-model="form.nationality" class="input" :placeholder="t('guest.nationality')" />
    <label class="flex items-center gap-2 text-sm text-slate-600">
      {{ t('guest.birthDate') }}
      <input v-model="form.birthDate" class="input" type="date" />
    </label>
    <input v-model="form.taxId" class="input" :placeholder="t('guest.taxId')" />
    <input v-model="form.address" class="input" :placeholder="t('guest.address')" />
    <textarea v-model="form.notes" class="input sm:col-span-2" rows="2" :placeholder="t('common.notes')" />
    <p v-if="error" class="text-sm text-rose-600 sm:col-span-2">{{ error }}</p>
    <div class="flex justify-end gap-2 sm:col-span-2">
      <button class="btn-secondary" type="button" @click="emit('cancel')">{{ t('common.close') }}</button>
      <button class="btn" type="submit" :disabled="saving">{{ guest ? t('common.save') : t('guest.create') }}</button>
    </div>
  </form>
</template>

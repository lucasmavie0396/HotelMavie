<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Guest } from '@/types';

const props = defineProps<{ guest?: Guest | null }>();
const emit = defineEmits<{ saved: [guest: Guest]; cancel: [] }>();

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
    <input v-model="form.firstName" class="input" placeholder="Nome" required />
    <input v-model="form.lastName" class="input" placeholder="Apelido" required />
    <input v-model="form.email" class="input" type="email" placeholder="Email" />
    <input v-model="form.phone" class="input" placeholder="Telefone" />
    <input v-model="form.documentType" class="input" placeholder="Tipo de documento" />
    <input v-model="form.documentNumber" class="input" placeholder="Numero do documento" />
    <input v-model="form.nationality" class="input" placeholder="Nacionalidade" />
    <label class="flex items-center gap-2 text-sm text-slate-600">
      Nascimento
      <input v-model="form.birthDate" class="input" type="date" />
    </label>
    <input v-model="form.taxId" class="input" placeholder="NIF / contribuinte" />
    <input v-model="form.address" class="input" placeholder="Morada" />
    <textarea v-model="form.notes" class="input sm:col-span-2" rows="2" placeholder="Notas" />
    <p v-if="error" class="text-sm text-rose-600 sm:col-span-2">{{ error }}</p>
    <div class="flex justify-end gap-2 sm:col-span-2">
      <button class="btn-secondary" type="button" @click="emit('cancel')">Fechar</button>
      <button class="btn" type="submit" :disabled="saving">{{ guest ? 'Guardar' : 'Criar hospede' }}</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import { usePaymentTypesStore } from '@/stores/paymentTypes';
import type { PaymentMethod, PaymentType } from '@/types';

const KINDS: Record<PaymentMethod, string> = {
  CASH: 'Numerario (entra na caixa)',
  CARD: 'Cartao',
  TRANSFER: 'Transferencia',
  MOBILE: 'Pagamento movel',
  OTHER: 'Outro',
};
const MECHANISMS: Record<string, string> = {
  NU: 'NU - Numerario',
  CC: 'CC - Cartao de credito',
  CD: 'CD - Cartao de debito',
  TB: 'TB - Transferencia bancaria',
  MB: 'MB - Referencia de pagamento',
  CH: 'CH - Cheque',
  CI: 'CI - Credito documentario',
  CO: 'CO - Cheque ou cartao oferta',
  CS: 'CS - Compensacao de saldos',
  DE: 'DE - Dinheiro eletronico',
  LC: 'LC - Letra comercial',
  PR: 'PR - Permuta de bens',
  TR: 'TR - Ticket restaurante',
  OU: 'OU - Outro',
};
const DEFAULT_MECHANISM: Record<PaymentMethod, string> = { CASH: 'NU', CARD: 'CC', TRANSFER: 'TB', MOBILE: 'DE', OTHER: 'OU' };

const hotels = useHotelsStore();
const types = usePaymentTypesStore();
const error = ref('');
const notice = ref('');
const busy = ref(false);
const editingId = ref<number | null>(null);

function empty() {
  return { name: '', kind: 'MOBILE' as PaymentMethod, mechanism: 'DE', requiresReference: true, sortOrder: 10, active: true };
}
const form = reactive(empty());

async function run(fn: () => Promise<unknown>, message: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
    notice.value = message;
    await types.load(true);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function edit(type: PaymentType) {
  editingId.value = type.id;
  Object.assign(form, { name: type.name, kind: type.kind, mechanism: type.mechanism ?? DEFAULT_MECHANISM[type.kind], requiresReference: type.requiresReference, sortOrder: type.sortOrder, active: type.active });
}

function reset() {
  editingId.value = null;
  Object.assign(form, empty());
}

const save = () =>
  run(async () => {
    if (editingId.value) {
      const { kind: _kind, ...rest } = form;
      await api.patch(`/payment-types/${editingId.value}`, rest);
    } else {
      await api.post('/payment-types', { ...form, hotelId: hotels.selectedId });
    }
    reset();
  }, 'Tipo de pagamento guardado');

const toggle = (type: PaymentType) => run(() => api.patch(`/payment-types/${type.id}`, { active: !type.active }), type.active ? 'Desativado' : 'Ativado');

onMounted(() => types.load(true));
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-slate-600">
      Cria os tipos de pagamento que o hotel aceita (ex.: M-Pesa, e-Mola, POS BCI, cheque). O tipo base define se o valor entra na
      caixa (numerario) e o codigo de meio de pagamento no SAF-T.
    </p>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <form class="card grid gap-3 sm:grid-cols-3" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-3">{{ editingId ? 'Editar tipo de pagamento' : 'Novo tipo de pagamento' }}</h2>
      <label class="text-sm">Nome<input v-model="form.name" class="input" placeholder="Ex.: M-Pesa" required /></label>
      <label class="text-sm">
        Tipo base
        <select v-model="form.kind" class="input" :disabled="Boolean(editingId)" @change="form.mechanism = DEFAULT_MECHANISM[form.kind]">
          <option v-for="(label, kind) in KINDS" :key="kind" :value="kind">{{ label }}</option>
        </select>
      </label>
      <label class="text-sm">
        Meio no SAF-T
        <select v-model="form.mechanism" class="input">
          <option v-for="(label, code) in MECHANISMS" :key="code" :value="code">{{ label }}</option>
        </select>
      </label>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.requiresReference" type="checkbox" />Exige referencia (n.o da transacao)</label>
      <label class="text-sm">Ordem<input v-model.number="form.sortOrder" class="input" type="number" /></label>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.active" type="checkbox" />Ativo</label>
      <div class="flex justify-end gap-2 sm:col-span-3">
        <button v-if="editingId" class="btn-secondary" type="button" @click="reset">Cancelar</button>
        <button class="btn" type="submit" :disabled="busy">Guardar</button>
      </div>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr><th class="px-4 py-3">Nome</th><th class="px-4 py-3">Tipo base</th><th class="px-4 py-3">SAF-T</th><th class="px-4 py-3">Referencia</th><th class="px-4 py-3">Estado</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="type in types.all" :key="type.id" class="border-b border-slate-100" :class="type.active ? '' : 'text-slate-400'">
            <td class="px-4 py-3 font-medium">{{ type.name }}</td>
            <td class="px-4 py-3">{{ KINDS[type.kind] }}</td>
            <td class="px-4 py-3">{{ type.mechanism ?? '-' }}</td>
            <td class="px-4 py-3">{{ type.requiresReference ? 'Obrigatoria' : 'Opcional' }}</td>
            <td class="px-4 py-3">{{ type.active ? 'Ativo' : 'Inativo' }}</td>
            <td class="space-x-3 px-4 py-3 text-right text-xs">
              <button class="text-indigo-600 hover:underline" type="button" @click="edit(type)">Editar</button>
              <button class="text-indigo-600 hover:underline" type="button" @click="toggle(type)">{{ type.active ? 'Desativar' : 'Ativar' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

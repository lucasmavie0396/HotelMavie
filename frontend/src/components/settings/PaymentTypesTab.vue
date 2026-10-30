<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { translated } from '@/i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import { usePaymentTypesStore } from '@/stores/paymentTypes';
import type { PaymentMethod, PaymentType } from '@/types';

const KINDS = translated<PaymentMethod>('paymentTypesTab.kinds', ['CASH', 'CARD', 'TRANSFER', 'MOBILE', 'OTHER']);
const MECHANISM_CODES = ['NU', 'CC', 'CD', 'TB', 'MB', 'CH', 'CI', 'CO', 'CS', 'DE', 'LC', 'PR', 'TR', 'OU'] as const;
const MECHANISMS = translated('paymentTypesTab.mechanisms', MECHANISM_CODES);
const DEFAULT_MECHANISM: Record<PaymentMethod, string> = { CASH: 'NU', CARD: 'CC', TRANSFER: 'TB', MOBILE: 'DE', OTHER: 'OU' };

const { t } = useI18n();
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
  }, t('paymentTypesTab.saved'));

const toggle = (type: PaymentType) => run(() => api.patch(`/payment-types/${type.id}`, { active: !type.active }), type.active ? t('paymentTypesTab.deactivated') : t('paymentTypesTab.activated'));

onMounted(() => types.load(true));
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-slate-600">
      {{ t('paymentTypesTab.hint') }}
    </p>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <form class="card grid gap-3 sm:grid-cols-3" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-3">{{ editingId ? t('paymentTypesTab.edit') : t('paymentTypesTab.new') }}</h2>
      <label class="text-sm">{{ t('common.name') }}<input v-model="form.name" class="input" :placeholder="t('paymentTypesTab.nameExample')" required /></label>
      <label class="text-sm">
        {{ t('paymentTypesTab.kind') }}
        <select v-model="form.kind" class="input" :disabled="Boolean(editingId)" @change="form.mechanism = DEFAULT_MECHANISM[form.kind]">
          <option v-for="(label, kind) in KINDS" :key="kind" :value="kind">{{ label }}</option>
        </select>
      </label>
      <label class="text-sm">
        {{ t('paymentTypesTab.mechanism') }}
        <select v-model="form.mechanism" class="input">
          <option v-for="(label, code) in MECHANISMS" :key="code" :value="code">{{ code }} - {{ label }}</option>
        </select>
      </label>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.requiresReference" type="checkbox" />{{ t('paymentTypesTab.requiresReference') }}</label>
      <label class="text-sm">{{ t('paymentTypesTab.order') }}<input v-model.number="form.sortOrder" class="input" type="number" /></label>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.active" type="checkbox" />{{ t('paymentTypesTab.active') }}</label>
      <div class="flex justify-end gap-2 sm:col-span-3">
        <button v-if="editingId" class="btn-secondary" type="button" @click="reset">{{ t('common.cancel') }}</button>
        <button class="btn" type="submit" :disabled="busy">{{ t('common.save') }}</button>
      </div>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr><th class="px-4 py-3">{{ t('common.name') }}</th><th class="px-4 py-3">{{ t('paymentTypesTab.kind') }}</th><th class="px-4 py-3">SAF-T</th><th class="px-4 py-3">{{ t('paymentTypesTab.reference') }}</th><th class="px-4 py-3">{{ t('common.status') }}</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="type in types.all" :key="type.id" class="border-b border-slate-100" :class="type.active ? '' : 'text-slate-400'">
            <td class="px-4 py-3 font-medium">{{ type.name }}</td>
            <td class="px-4 py-3">{{ KINDS[type.kind] }}</td>
            <td class="px-4 py-3">{{ type.mechanism ?? '-' }}</td>
            <td class="px-4 py-3">{{ type.requiresReference ? t('paymentTypesTab.required') : t('paymentTypesTab.optional') }}</td>
            <td class="px-4 py-3">{{ type.active ? t('paymentTypesTab.active') : t('paymentTypesTab.inactive') }}</td>
            <td class="space-x-3 px-4 py-3 text-right text-xs">
              <button class="text-indigo-600 hover:underline" type="button" @click="edit(type)">{{ t('common.edit') }}</button>
              <button class="text-indigo-600 hover:underline" type="button" @click="toggle(type)">{{ type.active ? t('purchases.deactivate') : t('purchases.activate') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

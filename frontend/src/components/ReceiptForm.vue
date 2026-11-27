<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import CashRequired from '@/components/CashRequired.vue';
import PaymentTypeSelect from '@/components/PaymentTypeSelect.vue';
import { useOwnCash } from '@/composables/cashGuard';
import { api, errorMessage, openInvoicePdf } from '@/services/api';
import { printDocument } from '@/services/print';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, CustomerAccount, OpenInvoice, ReceiptDoc } from '@/types';
import { formatDate, formatMoney } from '@/utils/format';

const props = defineProps<{ customerKey?: string | null }>();
const emit = defineEmits<{ close: []; issued: [receipt: ReceiptDoc] }>();

const { t } = useI18n();
const hotels = useHotelsStore();
const accounts = ref<CustomerAccount[]>([]);
const registers = ref<CashRegister[]>([]);
const key = ref(props.customerKey ?? '');
const openInvoices = ref<OpenInvoice[]>([]);
const amounts = reactive<Record<number, number>>({});
const payment = reactive({ paymentTypeId: 0, cashSessionId: 0, reference: '' });
const error = ref('');
const busy = ref(false);

const money = (value: string | number) => formatMoney(value, hotels.currency);
const total = computed(() => openInvoices.value.reduce((sum, invoice) => sum + Number(amounts[invoice.id] || 0), 0));
const hasCash = useOwnCash(registers);
const account = computed(() => accounts.value.find((item) => item.customerKey === key.value) ?? null);

async function loadInvoices() {
  openInvoices.value = [];
  for (const id of Object.keys(amounts)) delete amounts[Number(id)];
  if (!key.value) return;
  try {
    openInvoices.value = (await api.get<OpenInvoice[]>('/invoices-open', { params: { hotelId: hotels.selectedId, customer: key.value } })).data;
    for (const invoice of openInvoices.value) amounts[invoice.id] = Number(invoice.open);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function issue() {
  busy.value = true;
  error.value = '';
  try {
    const lines = openInvoices.value
      .filter((invoice) => Number(amounts[invoice.id]) > 0)
      .map((invoice) => ({ invoiceId: invoice.id, amount: Number(amounts[invoice.id]) }));
    const { data } = await api.post<ReceiptDoc>('/receipts', {
      hotelId: hotels.selectedId,
      paymentTypeId: payment.paymentTypeId,
      cashSessionId: payment.cashSessionId || undefined,
      reference: payment.reference || undefined,
      lines,
    });
    emit('issued', data);
    await printDocument({ document: 'RECEIPT', receiptId: data.id });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const params = { hotelId: hotels.selectedId };
    const [a, c] = await Promise.all([api.get<CustomerAccount[]>('/accounts', { params }), api.get<CashRegister[]>('/cash-registers', { params })]);
    accounts.value = a.data;
    registers.value = c.data;
  } catch (e) {
    error.value = errorMessage(e);
  }
  await loadInvoices();
});
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center" role="dialog" aria-modal="true" :aria-label="t('documents.newReceipt')">
    <form class="max-h-[92dvh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" data-testid="receipt-form" @submit.prevent="issue">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">{{ account ? t('accounts.receiptFor', { name: account.customerName }) : t('documents.newReceipt') }}</h2>
        <button class="btn-icon" type="button" :aria-label="t('common.close')" @click="emit('close')">✕</button>
      </div>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <label class="block text-sm">
        <span class="mb-1 block text-slate-600">{{ t('invoices.customer') }}</span>
        <select v-model="key" class="input" @change="loadInvoices">
          <option value="">{{ t('documents.chooseCustomer') }}</option>
          <option v-for="item in accounts" :key="item.customerKey" :value="item.customerKey">
            {{ item.customerName }}{{ item.customerTaxId ? ` · ${item.customerTaxId}` : '' }} · {{ money(item.open) }}
          </option>
        </select>
      </label>
      <p v-if="!accounts.length" class="text-sm text-slate-500">{{ t('accounts.none') }}</p>
      <table v-if="openInvoices.length" class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr><th class="py-2">{{ t('folio.invoiceColumn') }}</th><th class="py-2">{{ t('common.date') }}</th><th class="py-2 text-right">{{ t('common.total') }}</th><th class="py-2 text-right">{{ t('accounts.open') }}</th><th class="py-2 text-right">{{ t('accounts.toReceive') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="invoice in openInvoices" :key="invoice.id" class="border-b border-slate-100">
            <td class="py-2"><button class="text-indigo-600 hover:underline" type="button" @click="openInvoicePdf(invoice.id)">{{ invoice.fullNumber }}</button></td>
            <td class="py-2">{{ formatDate(invoice.issuedAt) }}</td>
            <td class="py-2 text-right">{{ money(invoice.grossTotal) }}</td>
            <td class="py-2 text-right">{{ money(invoice.open) }}</td>
            <td class="py-2 text-right"><input v-model.number="amounts[invoice.id]" class="input w-28 text-right" type="number" min="0" :max="Number(invoice.open)" step="0.01" /></td>
          </tr>
        </tbody>
      </table>
      <template v-if="key">
        <CashRequired :registers="registers" />
        <div class="grid gap-3 sm:grid-cols-4">
          <PaymentTypeSelect v-model:type-id="payment.paymentTypeId" v-model:cash-session-id="payment.cashSessionId" v-model:reference="payment.reference" :registers="registers" />
          <button class="btn" type="submit" :disabled="busy || !hasCash || total <= 0 || !payment.paymentTypeId">{{ t('accounts.issue', { amount: money(total) }) }}</button>
        </div>
      </template>
    </form>
  </div>
</template>

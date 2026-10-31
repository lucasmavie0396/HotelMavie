<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import CashRequired from '@/components/CashRequired.vue';
import PaymentTypeSelect from '@/components/PaymentTypeSelect.vue';
import { useOwnCash } from '@/composables/cashGuard';
import { api, errorMessage, openInvoicePdf } from '@/services/api';
import { printDocument } from '@/services/print';
import { usePaymentTypesStore } from '@/stores/paymentTypes';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, CustomerAccount, OpenInvoice, ReceiptDoc } from '@/types';
import { formatDate, formatDateTime, formatMoney, PAYMENT_METHOD_LABELS } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const accounts = ref<CustomerAccount[]>([]);
const receipts = ref<ReceiptDoc[]>([]);
const registers = ref<CashRegister[]>([]);
const selected = ref<CustomerAccount | null>(null);
const openInvoices = ref<OpenInvoice[]>([]);
const amounts = reactive<Record<number, number>>({});
const payment = reactive({ paymentTypeId: 0, cashSessionId: 0, reference: '' });
const paymentTypes = usePaymentTypesStore();
const error = ref('');
const busy = ref(false);

const isManager = computed(() => auth.user?.role !== 'RECEPTION');
const money = (value: string | number) => formatMoney(value, hotels.currency);
const total = computed(() => openInvoices.value.reduce((sum, invoice) => sum + Number(amounts[invoice.id] || 0), 0));
const totalOpen = computed(() => accounts.value.reduce((sum, account) => sum + Number(account.open), 0));
const hasCash = useOwnCash(registers);

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
}

async function load() {
  error.value = '';
  try {
    const params = { hotelId: hotels.selectedId };
    const [a, r, c] = await Promise.all([
      api.get<CustomerAccount[]>('/accounts', { params }),
      api.get<ReceiptDoc[]>('/receipts', { params }),
      api.get<CashRegister[]>('/cash-registers', { params }),
    ]);
    accounts.value = a.data;
    receipts.value = r.data;
    registers.value = c.data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function select(account: CustomerAccount) {
  selected.value = account;
  try {
    openInvoices.value = (await api.get<OpenInvoice[]>('/invoices-open', { params: { hotelId: hotels.selectedId, customer: account.customerKey } })).data;
    for (const key of Object.keys(amounts)) delete amounts[Number(key)];
    for (const invoice of openInvoices.value) amounts[invoice.id] = Number(invoice.open);
    payment.reference = '';
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
    selected.value = null;
    payment.reference = '';
    await load();
    await printDocument({ document: 'RECEIPT', receiptId: data.id });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function cancel(receipt: ReceiptDoc) {
  const reason = window.prompt(t('accounts.cancelPrompt', { number: receipt.fullNumber }));
  if (!reason) return;
  try {
    await api.post(`/receipts/${receipt.id}/cancel`, { reason });
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function pdf(id: number) {
  printDocument({ document: 'RECEIPT', receiptId: id }).catch((e) => (error.value = errorMessage(e)));
}

function pdfA4(id: number) {
  openInvoicePdf(id, 'receipts').catch((e) => (error.value = errorMessage(e)));
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="accounts" :subtitle="t('accounts.subtitle')">
      <p class="rounded-xl bg-white/15 px-4 py-2 text-sm backdrop-blur">{{ t('accounts.totalOpen') }} <strong class="block text-xl">{{ money(totalOpen) }}</strong></p>
    </PageHeader>

    <p class="text-sm text-slate-600">
      {{ t('accounts.hint') }}
    </p>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('invoices.customer') }}</th>
            <th class="px-4 py-3">{{ t('purchases.taxId') }}</th>
            <th class="px-4 py-3 text-right">{{ t('accounts.invoices') }}</th>
            <th class="px-4 py-3">{{ t('accounts.oldest') }}</th>
            <th class="px-4 py-3 text-right">{{ t('accounts.open') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="account in accounts" :key="account.customerKey" class="border-b border-slate-100">
            <td class="px-4 py-3 font-medium">{{ account.customerName }}</td>
            <td class="px-4 py-3">{{ account.customerTaxId ?? '-' }}</td>
            <td class="px-4 py-3 text-right">{{ account.invoices }}</td>
            <td class="px-4 py-3" :class="daysSince(account.oldest) > 30 ? 'text-rose-700' : ''">
              {{ formatDate(account.oldest) }} ({{ t('calendar.days', { n: daysSince(account.oldest) }) }})
            </td>
            <td class="px-4 py-3 text-right font-semibold">{{ money(account.open) }}</td>
            <td class="px-4 py-3 text-right">
              <button class="btn px-3 py-1 text-xs" type="button" @click="select(account)">{{ t('roomAccount.receive') }}</button>
            </td>
          </tr>
          <tr v-if="!accounts.length">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">{{ t('accounts.none') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <form v-if="selected" class="card space-y-4" @submit.prevent="issue">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">{{ t('accounts.receiptFor', { name: selected.customerName }) }}</h2>
        <button class="text-sm text-slate-500 hover:underline" type="button" @click="selected = null">{{ t('common.close') }}</button>
      </div>
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr><th class="py-2">{{ t('folio.invoiceColumn') }}</th><th class="py-2">{{ t('common.date') }}</th><th class="py-2 text-right">{{ t('common.total') }}</th><th class="py-2 text-right">{{ t('accounts.open') }}</th><th class="py-2 text-right">{{ t('accounts.toReceive') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="invoice in openInvoices" :key="invoice.id" class="border-b border-slate-100">
            <td class="py-2">
              <button class="text-indigo-600 hover:underline" type="button" @click="openInvoicePdf(invoice.id)">{{ invoice.fullNumber }}</button>
            </td>
            <td class="py-2">{{ formatDate(invoice.issuedAt) }}</td>
            <td class="py-2 text-right">{{ money(invoice.grossTotal) }}</td>
            <td class="py-2 text-right">{{ money(invoice.open) }}</td>
            <td class="py-2 text-right">
              <input v-model.number="amounts[invoice.id]" class="input w-28 text-right" type="number" min="0" :max="Number(invoice.open)" step="0.01" />
            </td>
          </tr>
        </tbody>
      </table>
      <CashRequired :registers="registers" />
      <div class="grid gap-3 sm:grid-cols-4">
        <PaymentTypeSelect
          v-model:type-id="payment.paymentTypeId"
          v-model:cash-session-id="payment.cashSessionId"
          v-model:reference="payment.reference"
          :registers="registers"
        />
        <button class="btn" type="submit" :disabled="busy || !hasCash || total <= 0 || !payment.paymentTypeId">{{ t('accounts.issue', { amount: money(total) }) }}</button>
      </div>
    </form>

    <div class="card overflow-x-auto p-0">
      <h2 class="px-4 pt-4 font-semibold">{{ t('accounts.receipts') }}</h2>
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr>
            <th class="px-4 py-2">{{ t('rooms.number') }}</th>
            <th class="px-4 py-2">{{ t('common.date') }}</th>
            <th class="px-4 py-2">{{ t('invoices.customer') }}</th>
            <th class="px-4 py-2">{{ t('accounts.invoices') }}</th>
            <th class="px-4 py-2">{{ t('accounts.method') }}</th>
            <th class="px-4 py-2 text-right">{{ t('common.value') }}</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in receipts" :key="item.id" class="border-b border-slate-100" :class="item.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''">
            <td class="px-4 py-2">
              <button class="text-indigo-600 hover:underline" type="button" @click="pdf(item.id)">{{ item.fullNumber }}</button>
            </td>
            <td class="px-4 py-2">{{ formatDateTime(item.issuedAt) }}</td>
            <td class="px-4 py-2">{{ item.customerName }}</td>
            <td class="px-4 py-2">{{ item.lines.map((line) => line.invoice.fullNumber).join(', ') }}</td>
            <td class="px-4 py-2">{{ paymentTypes.byId(item.paymentTypeId)?.name ?? PAYMENT_METHOD_LABELS[item.method] }}</td>
            <td class="px-4 py-2 text-right">{{ money(item.amount) }}</td>
            <td class="px-4 py-2 text-right">
              <button
                v-if="isManager && item.status === 'ISSUED'"
                class="text-xs text-rose-600 hover:underline"
                type="button"
                @click="cancel(item)"
              >
                {{ t('pos.void') }}
              </button>
            </td>
          </tr>
          <tr v-if="!receipts.length"><td colspan="7" class="px-4 py-4 text-center text-slate-500">{{ t('accounts.noReceipts') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import PaperLinks from '@/components/PaperLinks.vue';
import ReceiptForm from '@/components/ReceiptForm.vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { askText } from '@/services/dialog';
import { printDocument } from '@/services/print';
import { usePaymentTypesStore } from '@/stores/paymentTypes';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { CustomerAccount, ReceiptDoc } from '@/types';
import { formatDate, formatDateTime, formatMoney, PAYMENT_METHOD_LABELS } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const accounts = ref<CustomerAccount[]>([]);
const receipts = ref<ReceiptDoc[]>([]);
const selectedKey = ref<string | null>(null);
const paymentTypes = usePaymentTypesStore();
const error = ref('');

const isManager = computed(() => auth.isManager);
const money = (value: string | number) => formatMoney(value, hotels.currency);
const totalOpen = computed(() => accounts.value.reduce((sum, account) => sum + Number(account.open), 0));

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
}

async function load() {
  error.value = '';
  try {
    const params = { hotelId: hotels.selectedId };
    const [a, r] = await Promise.all([api.get<CustomerAccount[]>('/accounts', { params }), api.get<ReceiptDoc[]>('/receipts', { params })]);
    accounts.value = a.data;
    receipts.value = r.data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function issued() {
  selectedKey.value = null;
  await load();
}

async function cancel(receipt: ReceiptDoc) {
  const reason = await askText({ title: t('accounts.cancelPrompt', { number: receipt.fullNumber }), required: true, danger: true });
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
              <button class="btn px-3 py-1 text-xs" type="button" @click="selectedKey = account.customerKey">{{ t('roomAccount.receive') }}</button>
            </td>
          </tr>
          <tr v-if="!accounts.length">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">{{ t('accounts.none') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ReceiptForm v-if="selectedKey" :customer-key="selectedKey" @close="selectedKey = null" @issued="issued" />

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
              <PaperLinks class="ml-2" :params="{ document: 'RECEIPT', receiptId: item.id }" :title="item.fullNumber" @error="error = $event" />
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

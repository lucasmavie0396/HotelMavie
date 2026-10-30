<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, emailInvoice, errorMessage, openInvoicePdf } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { InvoiceSummary, InvoiceType } from '@/types';
import { formatDateTime, formatMoney, INVOICE_TYPE_LABELS } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const invoices = ref<InvoiceSummary[]>([]);
const error = ref('');
const filters = reactive({ type: '' as InvoiceType | '', from: '', to: '', q: '' });

const isManager = computed(() => auth.user?.role !== 'RECEPTION');
const totals = computed(() => {
  let issued = 0;
  let credited = 0;
  for (const invoice of invoices.value) {
    if (invoice.type === 'CREDIT_NOTE') {
      credited += Number(invoice.grossTotal);
    } else {
      issued += Number(invoice.grossTotal);
    }
  }
  return { issued, credited, net: issued - credited };
});

async function load() {
  error.value = '';
  try {
    invoices.value = (
      await api.get<InvoiceSummary[]>('/invoices', {
        params: {
          hotelId: hotels.selectedId,
          type: filters.type || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          q: filters.q || undefined,
        },
      })
    ).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function credit(invoice: InvoiceSummary) {
  const reason = window.prompt(t('invoices.creditPrompt', { number: invoice.fullNumber }));
  if (!reason) {
    return;
  }
  try {
    const { data } = await api.post<{ id: number }>(`/invoices/${invoice.id}/credit-note`, { reason });
    await load();
    await openInvoicePdf(data.id);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function sendEmail(invoice: InvoiceSummary) {
  emailInvoice(invoice.id, invoice.fullNumber).catch((e) => (error.value = errorMessage(e)));
}

function pdf(id: number) {
  openInvoicePdf(id).catch((e) => (error.value = errorMessage(e)));
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="invoices" :subtitle="t('invoices.subtitle')" />

    <p class="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      {{ t('invoices.notCertified') }}
    </p>

    <form class="card grid gap-3 sm:grid-cols-5" @submit.prevent="load">
      <input v-model="filters.q" class="input sm:col-span-2" :placeholder="t('invoices.search')" />
      <select v-model="filters.type" class="input">
        <option value="">{{ t('stock.allTypes') }}</option>
        <template v-for="(label, type) in INVOICE_TYPE_LABELS" :key="type">
          <option v-if="type !== 'RECEIPT'" :value="type">{{ label }}</option>
        </template>
      </select>
      <input v-model="filters.from" class="input" type="date" :aria-label="t('common.from')" />
      <input v-model="filters.to" class="input" type="date" :aria-label="t('common.to')" />
      <div class="flex justify-end sm:col-span-5">
        <button class="btn" type="submit">{{ t('common.filter') }}</button>
      </div>
    </form>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="grid gap-4 sm:grid-cols-3">
      <div class="card"><p class="text-sm text-slate-500">{{ t('invoices.issued') }}</p><p class="text-2xl font-semibold">{{ formatMoney(totals.issued, hotels.currency) }}</p></div>
      <div class="card"><p class="text-sm text-slate-500">{{ t('invoices.credited') }}</p><p class="text-2xl font-semibold">{{ formatMoney(totals.credited, hotels.currency) }}</p></div>
      <div class="card"><p class="text-sm text-slate-500">{{ t('invoices.net') }}</p><p class="text-2xl font-semibold">{{ formatMoney(totals.net, hotels.currency) }}</p></div>
    </div>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('rooms.number') }}</th>
            <th class="px-4 py-3">{{ t('rooms.type') }}</th>
            <th class="px-4 py-3">{{ t('common.date') }}</th>
            <th class="px-4 py-3">{{ t('invoices.customer') }}</th>
            <th class="px-4 py-3">{{ t('purchases.taxId') }}</th>
            <th class="px-4 py-3 text-right">{{ t('common.total') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="invoice in invoices" :key="invoice.id" class="border-b border-slate-100 last:border-0">
            <td class="px-4 py-3 font-medium">
              <button class="text-indigo-600 hover:underline" type="button" @click="pdf(invoice.id)">{{ invoice.fullNumber }}</button>
              <span v-if="invoice.status === 'CREDITED'" class="ml-2 text-xs text-rose-600">{{ t('folio.credited') }}</span>
            </td>
            <td class="px-4 py-3">{{ INVOICE_TYPE_LABELS[invoice.type] }}</td>
            <td class="px-4 py-3">{{ formatDateTime(invoice.issuedAt) }}</td>
            <td class="px-4 py-3">{{ invoice.customerName }}</td>
            <td class="px-4 py-3">{{ invoice.customerTaxId ?? '-' }}</td>
            <td class="px-4 py-3 text-right">{{ formatMoney(invoice.grossTotal, invoice.currency) }}</td>
            <td class="px-4 py-3 text-right">
              <RouterLink
                v-if="invoice.reservationId"
                :to="{ name: 'reservation', params: { id: invoice.reservationId } }"
                class="mr-3 text-xs text-indigo-600 hover:underline"
              >
                {{ t('invoices.reservation') }}
              </RouterLink>
              <button class="mr-3 text-xs text-indigo-600 hover:underline" type="button" @click="sendEmail(invoice)">{{ t('common.email') }}</button>
              <button
                v-if="isManager && invoice.type !== 'CREDIT_NOTE' && invoice.status === 'ISSUED'"
                class="text-xs text-rose-600 hover:underline"
                type="button"
                @click="credit(invoice)"
              >
                {{ t('invoices.creditNote') }}
              </button>
            </td>
          </tr>
          <tr v-if="!invoices.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">{{ t('invoices.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

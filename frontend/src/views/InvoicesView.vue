<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import ExportList from '@/components/ExportList.vue';
import DocumentDetail, { type DocumentKind } from '@/components/DocumentDetail.vue';
import DocumentForm from '@/components/DocumentForm.vue';
import ReceiptForm from '@/components/ReceiptForm.vue';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { InvoiceSummary, Quote, ReceiptDoc } from '@/types';
import { formatDate, formatDateTime, formatMoney, INVOICE_TYPE_LABELS } from '@/utils/format';

type DocType = 'INVOICE' | 'INVOICE_RECEIPT' | 'CREDIT_NOTE' | 'RECEIPT' | 'QUOTE';
type DocState = 'ISSUED' | 'CANCELLED' | 'CONVERTED' | 'CREDITED';
type Tone = 'green' | 'amber' | 'red' | 'slate';

interface Row {
  kind: DocumentKind;
  id: number;
  type: DocType;
  number: string;
  issuedAt: string;
  dueDate: string | null;
  validUntil: string | null;
  customerName: string;
  customerTaxId: string | null;
  state: string;
  tone: Tone;
  total: number;
  open: number;
  dimmed: boolean;
  origin: string | null;
}

const { t } = useI18n();
const hotels = useHotelsStore();

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const today = isoDay(new Date());
const filters = reactive({ q: '', type: '' as DocType | '', state: '' as DocState | '', from: `${today.slice(0, 7)}-01`, to: today, unpaid: false });
const rows = ref<Row[]>([]);
const error = ref('');
const loading = ref(false);
const opened = ref<{ kind: DocumentKind; id: number } | null>(null);
const form = ref<'INVOICE' | 'QUOTE' | null>(null);
const receiptFor = ref<string | null | undefined>(undefined);

const TYPE_OPTIONS = computed<{ value: DocType; label: string }[]>(() => [
  { value: 'INVOICE', label: INVOICE_TYPE_LABELS.INVOICE },
  { value: 'INVOICE_RECEIPT', label: INVOICE_TYPE_LABELS.INVOICE_RECEIPT },
  { value: 'CREDIT_NOTE', label: INVOICE_TYPE_LABELS.CREDIT_NOTE },
  { value: 'RECEIPT', label: t('documents.receiptRg') },
  { value: 'QUOTE', label: t('documents.quote') },
]);
const typeLabel = (type: DocType) => TYPE_OPTIONS.value.find((option) => option.value === type)?.label ?? type;
const money = (value: number | string) => formatMoney(value, hotels.currency);
const TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-rose-50 text-rose-700',
  slate: 'bg-slate-100 text-slate-600',
};

function invoiceRow(invoice: InvoiceSummary): Row {
  const open = Number(invoice.open ?? 0);
  let state = t('documents.state.issued');
  let tone: Tone = 'green';
  if (invoice.status === 'CREDITED') [state, tone] = [t('documents.state.credited'), 'red'];
  else if (invoice.type === 'INVOICE' && open > 0) [state, tone] = [t('documents.state.unpaid'), 'amber'];
  else if (invoice.type === 'INVOICE') state = t('documents.state.settled');
  return {
    kind: 'INVOICE',
    id: invoice.id,
    type: invoice.type as DocType,
    number: invoice.fullNumber,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate ?? null,
    validUntil: null,
    customerName: invoice.customerName ?? '',
    customerTaxId: invoice.customerTaxId ?? null,
    state,
    tone,
    total: Number(invoice.grossTotal) * (invoice.type === 'CREDIT_NOTE' ? -1 : 1),
    open,
    dimmed: invoice.status === 'CREDITED',
    origin: invoice.creditOf?.fullNumber ?? invoice.quote?.fullNumber ?? null,
  };
}

function receiptRow(receipt: ReceiptDoc): Row {
  const cancelled = receipt.status === 'CANCELLED';
  return {
    kind: 'RECEIPT',
    id: receipt.id,
    type: 'RECEIPT',
    number: receipt.fullNumber,
    issuedAt: receipt.issuedAt,
    dueDate: null,
    validUntil: null,
    customerName: receipt.customerName,
    customerTaxId: receipt.customerTaxId,
    state: cancelled ? t('documents.state.cancelled') : t('documents.state.issued'),
    tone: cancelled ? 'red' : 'green',
    total: Number(receipt.amount),
    open: 0,
    dimmed: cancelled,
    origin: receipt.lines.map((line) => line.invoice.fullNumber).join(', ') || null,
  };
}

function quoteRow(quote: Quote): Row {
  let state = t('documents.state.open');
  let tone: Tone = 'green';
  if (quote.status === 'CANCELLED') [state, tone] = [t('documents.state.cancelled'), 'red'];
  else if (quote.status === 'CONVERTED') [state, tone] = [t('documents.state.converted'), 'slate'];
  else if (quote.expired) [state, tone] = [t('documents.state.expired'), 'amber'];
  return {
    kind: 'QUOTE',
    id: quote.id,
    type: 'QUOTE',
    number: quote.fullNumber,
    issuedAt: quote.issuedAt,
    dueDate: null,
    validUntil: quote.validUntil,
    customerName: quote.customerName,
    customerTaxId: quote.customerTaxId,
    state,
    tone,
    total: Number(quote.grossTotal),
    open: 0,
    dimmed: quote.status === 'CANCELLED',
    origin: quote.invoice?.fullNumber ?? null,
  };
}

async function load() {
  error.value = '';
  loading.value = true;
  try {
    const base = { hotelId: hotels.selectedId, q: filters.q.trim() || undefined, from: filters.from || undefined, to: filters.to || undefined };
    const wants = (...types: DocType[]) => !filters.type || types.includes(filters.type);
    const requests: Promise<Row[]>[] = [];
    if (filters.unpaid) {
      requests.push(api.get<InvoiceSummary[]>('/invoices', { params: { hotelId: hotels.selectedId, q: base.q, unpaid: true } }).then((r) => r.data.map(invoiceRow)));
    } else {
      if (wants('INVOICE', 'INVOICE_RECEIPT', 'CREDIT_NOTE') && ['', 'ISSUED', 'CREDITED'].includes(filters.state)) {
        const params = { ...base, type: filters.type && filters.type !== 'RECEIPT' && filters.type !== 'QUOTE' ? filters.type : undefined, status: filters.state || undefined };
        requests.push(api.get<InvoiceSummary[]>('/invoices', { params }).then((r) => r.data.filter((invoice) => invoice.type !== 'RECEIPT').map(invoiceRow)));
      }
      if (wants('RECEIPT') && ['', 'ISSUED', 'CANCELLED'].includes(filters.state)) {
        requests.push(api.get<ReceiptDoc[]>('/receipts', { params: { ...base, status: filters.state || undefined } }).then((r) => r.data.map(receiptRow)));
      }
      if (wants('QUOTE') && ['', 'ISSUED', 'CANCELLED', 'CONVERTED'].includes(filters.state)) {
        const status = filters.state === 'ISSUED' ? 'OPEN' : filters.state || undefined;
        requests.push(api.get<Quote[]>('/quotes', { params: { ...base, status } }).then((r) => r.data.map(quoteRow)));
      }
    }
    rows.value = (await Promise.all(requests)).flat().sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => ({ ...filters }),
  () => {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  },
);
watch(() => hotels.selectedId, load);

function issued(kind: 'INVOICE' | 'QUOTE', id: number) {
  form.value = null;
  opened.value = { kind, id };
  void load();
}

function receive(customerKey: string) {
  opened.value = null;
  receiptFor.value = customerKey;
}

function receiptIssued(receipt: ReceiptDoc) {
  receiptFor.value = undefined;
  opened.value = { kind: 'RECEIPT', id: receipt.id };
  void load();
}

const exportColumns = () => [t('documents.document'), t('rooms.type'), t('common.date'), t('invoices.customer'), t('purchases.taxId'), t('common.status'), t('common.total'), t('documents.open')];
const exportRows = () => rows.value.map((row) => [row.number, typeLabel(row.type), formatDateTime(row.issuedAt), row.customerName, row.customerTaxId ?? '', row.state, row.total, row.open]);

onMounted(load);
</script>

<template>
  <section class="space-y-5">
    <PageHeader section="invoices" :subtitle="t('invoices.subtitle')">
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary" type="button" data-testid="new-quote" @click="form = 'QUOTE'">{{ t('documents.newQuote') }}</button>
        <button class="btn-secondary" type="button" data-testid="new-receipt" @click="receiptFor = null">{{ t('documents.newReceipt') }}</button>
        <button class="btn" type="button" data-testid="new-invoice" @click="form = 'INVOICE'">{{ t('documents.newInvoice') }}</button>
      </div>
    </PageHeader>

    <div class="card flex flex-wrap items-end gap-3">
      <label class="min-w-56 flex-1 text-sm">
        <span class="mb-1 block text-slate-600">{{ t('common.search') }}</span>
        <input v-model="filters.q" class="input" :placeholder="t('invoices.search')" />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('rooms.type') }}</span>
        <select v-model="filters.type" class="input w-52" :disabled="filters.unpaid">
          <option value="">{{ t('documents.allDocuments') }}</option>
          <option v-for="option in TYPE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('common.status') }}</span>
        <select v-model="filters.state" class="input w-44" :disabled="filters.unpaid">
          <option value="">{{ t('documents.allStates') }}</option>
          <option value="ISSUED">{{ t('documents.stateFilter.issued') }}</option>
          <option value="CANCELLED">{{ t('documents.stateFilter.cancelled') }}</option>
          <option value="CONVERTED">{{ t('documents.stateFilter.converted') }}</option>
          <option value="CREDITED">{{ t('documents.stateFilter.credited') }}</option>
        </select>
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('common.from') }}</span>
        <input v-model="filters.from" class="input" type="date" :max="filters.to" :disabled="filters.unpaid" />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('common.to') }}</span>
        <input v-model="filters.to" class="input" type="date" :min="filters.from" :disabled="filters.unpaid" />
      </label>
      <label class="flex min-h-11 items-center gap-2 text-sm">
        <input v-model="filters.unpaid" class="h-4 w-4" type="checkbox" data-testid="only-unpaid" />
        {{ t('documents.onlyUnpaid') }}
      </label>
      <ExportList class="ml-auto" :title="t('nav.invoices')" :columns="exportColumns()" :rows="exportRows" />
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm" data-testid="documents-table">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('documents.document') }}</th>
            <th class="px-4 py-3">{{ t('common.date') }}</th>
            <th class="px-4 py-3">{{ t('invoices.customer') }}</th>
            <th class="px-4 py-3">{{ t('common.status') }}</th>
            <th class="px-4 py-3 text-right">{{ t('common.total') }}</th>
            <th class="px-4 py-3 text-right">{{ t('documents.open') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="row in rows" :key="`${row.kind}-${row.id}`" class="cursor-pointer hover:bg-slate-50" :class="row.dimmed ? 'opacity-60' : ''" @click="opened = { kind: row.kind, id: row.id }">
            <td class="px-4 py-2">
              <button class="font-medium text-indigo-600 hover:underline" type="button" @click.stop="opened = { kind: row.kind, id: row.id }">{{ row.number }}</button>
              <p class="text-xs text-slate-500">{{ typeLabel(row.type) }}<template v-if="row.origin"> · {{ row.origin }}</template></p>
            </td>
            <td class="whitespace-nowrap px-4 py-2">
              {{ formatDateTime(row.issuedAt) }}
              <p v-if="row.dueDate" class="text-xs text-slate-500">{{ t('documents.dueOn', { date: formatDate(row.dueDate) }) }}</p>
              <p v-if="row.validUntil" class="text-xs text-slate-500">{{ t('documents.validOn', { date: formatDate(row.validUntil) }) }}</p>
            </td>
            <td class="px-4 py-2">
              {{ row.customerName }}
              <p v-if="row.customerTaxId" class="text-xs text-slate-500">NUIT {{ row.customerTaxId }}</p>
            </td>
            <td class="px-4 py-2"><span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="TONES[row.tone]">{{ row.state }}</span></td>
            <td class="px-4 py-2 text-right font-medium tabular-nums">{{ row.total < 0 ? '−' : '' }}{{ money(Math.abs(row.total)) }}</td>
            <td class="px-4 py-2 text-right tabular-nums">{{ row.open > 0 ? money(row.open) : '—' }}</td>
          </tr>
          <tr v-if="!rows.length && !loading">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">{{ t('invoices.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <DocumentDetail
      v-if="opened"
      :key="`${opened.kind}-${opened.id}`"
      :kind="opened.kind"
      :id="opened.id"
      @close="opened = null"
      @open="(kind, id) => (opened = { kind, id })"
      @changed="load"
      @receive="receive"
    />
    <DocumentForm v-if="form" :kind="form" @close="form = null" @issued="issued" />
    <ReceiptForm v-if="receiptFor !== undefined" :customer-key="receiptFor" @close="receiptFor = undefined" @issued="receiptIssued" />
  </section>
</template>

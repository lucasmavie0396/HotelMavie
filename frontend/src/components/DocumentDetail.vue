<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import PaperLinks from '@/components/PaperLinks.vue';
import { api, emailInvoice, errorMessage } from '@/services/api';
import { askText } from '@/services/dialog';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { InvoiceDetail, InvoiceSummary, Quote, ReceiptDoc } from '@/types';
import { formatDate, formatDateTime, formatMoney, INVOICE_TYPE_LABELS } from '@/utils/format';

export type DocumentKind = 'INVOICE' | 'RECEIPT' | 'QUOTE';

const props = defineProps<{ kind: DocumentKind; id: number }>();
const emit = defineEmits<{ close: []; open: [kind: DocumentKind, id: number]; changed: []; receive: [customerKey: string] }>();

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const invoice = ref<InvoiceDetail | null>(null);
const receipt = ref<ReceiptDoc | null>(null);
const quote = ref<Quote | null>(null);
const error = ref('');
const busy = ref(false);
const mode = ref<'view' | 'credit' | 'convert'>('view');
const credit = reactive<Record<number, string>>({});
const convert = reactive({ customerName: '', customerTaxId: '', customerAddress: '', customerEmail: '', dueDate: '' });

const isManager = computed(() => auth.isManager);
const money = (value: string | number) => formatMoney(value, invoice.value?.currency ?? quote.value?.currency ?? hotels.currency);
const title = computed(() => {
  if (invoice.value) return `${INVOICE_TYPE_LABELS[invoice.value.type]} ${invoice.value.fullNumber}`;
  if (receipt.value) return `${INVOICE_TYPE_LABELS.RECEIPT} ${receipt.value.fullNumber}`;
  if (quote.value) return `${t('documents.quote')} ${quote.value.fullNumber}`;
  return t('documents.document');
});
const printParams = computed(() => {
  if (props.kind === 'INVOICE') return { document: 'INVOICE', invoiceId: props.id };
  if (props.kind === 'RECEIPT') return { document: 'RECEIPT', receiptId: props.id };
  return { document: 'QUOTE', quoteId: props.id };
});
const activeReceipts = computed(() => invoice.value?.receipts.filter((item) => item.status === 'ISSUED') ?? []);
const canCredit = computed(
  () => isManager.value && invoice.value && invoice.value.type !== 'CREDIT_NOTE' && invoice.value.status === 'ISSUED' && !activeReceipts.value.length,
);
const partialCredit = computed(() => invoice.value?.type === 'INVOICE');
const creditTotal = computed(() => {
  if (!invoice.value) return 0;
  return invoice.value.lines.reduce((sum, line) => {
    const quantity = Number(String(credit[line.id] || '0').replace(',', '.'));
    return sum + (quantity > 0 ? (Number(line.grossAmount) * quantity) / Number(line.quantity) : 0);
  }, 0);
});

function remaining(line: InvoiceDetail['lines'][number]) {
  return Math.max(0, Number(line.quantity) - Number(line.creditedQuantity));
}

function customerKey(doc: { customerTaxId?: string | null; customerName?: string }) {
  return doc.customerTaxId ? `NIF:${doc.customerTaxId}` : `NOME:${doc.customerName ?? ''}`;
}

async function load() {
  error.value = '';
  try {
    if (props.kind === 'INVOICE') invoice.value = (await api.get<InvoiceDetail>(`/invoices/${props.id}/detail`)).data;
    if (props.kind === 'RECEIPT') receipt.value = (await api.get<ReceiptDoc>(`/receipts/${props.id}`)).data;
    if (props.kind === 'QUOTE') quote.value = (await api.get<Quote>(`/quotes/${props.id}`)).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function startCredit() {
  for (const key of Object.keys(credit)) delete credit[Number(key)];
  for (const line of invoice.value?.lines ?? []) credit[line.id] = '';
  mode.value = 'credit';
}

async function issueCredit(all: boolean) {
  if (!invoice.value) return;
  const lines = all
    ? undefined
    : invoice.value.lines
        .map((line) => ({ lineId: line.id, quantity: Number(String(credit[line.id] || '0').replace(',', '.')) }))
        .filter((line) => line.quantity > 0);
  if (lines && !lines.length) {
    error.value = t('documents.creditChooseLines');
    return;
  }
  const reason = await askText({ title: t('invoices.creditPrompt', { number: invoice.value.fullNumber }), required: true, danger: true });
  if (!reason) return;
  busy.value = true;
  try {
    const { data } = await api.post<InvoiceSummary>(`/invoices/${invoice.value.id}/credit-note`, { reason, lines });
    emit('changed');
    emit('open', 'INVOICE', data.id);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function cancelReceipt() {
  if (!receipt.value) return;
  const reason = await askText({ title: t('accounts.cancelPrompt', { number: receipt.value.fullNumber }), required: true, danger: true });
  if (!reason) return;
  try {
    await api.post(`/receipts/${receipt.value.id}/cancel`, { reason });
    emit('changed');
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function cancelQuote() {
  if (!quote.value) return;
  const reason = await askText({ title: t('documents.cancelQuotePrompt', { number: quote.value.fullNumber }), required: true, danger: true });
  if (!reason) return;
  try {
    await api.post(`/quotes/${quote.value.id}/cancel`, { reason });
    emit('changed');
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function startConvert() {
  if (!quote.value) return;
  Object.assign(convert, {
    customerName: quote.value.customerName === 'Consumidor final' ? '' : quote.value.customerName,
    customerTaxId: quote.value.customerTaxId ?? '',
    customerAddress: quote.value.customerAddress ?? '',
    customerEmail: quote.value.customerEmail ?? '',
    dueDate: '',
  });
  mode.value = 'convert';
}

async function convertQuote() {
  if (!quote.value) return;
  busy.value = true;
  error.value = '';
  try {
    const { data } = await api.post<InvoiceSummary>(`/quotes/${quote.value.id}/convert`, {
      customerName: convert.customerName.trim(),
      customerTaxId: convert.customerTaxId.trim() || undefined,
      customerAddress: convert.customerAddress.trim() || undefined,
      customerEmail: convert.customerEmail.trim() || undefined,
      dueDate: convert.dueDate || undefined,
    });
    emit('changed');
    emit('open', 'INVOICE', data.id);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function sendEmail() {
  if (invoice.value) emailInvoice(invoice.value.id, invoice.value.fullNumber).catch((e) => (error.value = errorMessage(e)));
}

onMounted(load);
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center" role="dialog" aria-modal="true" :aria-label="title">
    <div class="max-h-[94dvh] w-full max-w-4xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" data-testid="document-detail">
      <div class="flex items-start justify-between gap-3">
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <button class="btn-icon" type="button" :aria-label="t('common.close')" @click="emit('close')">✕</button>
      </div>
      <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>

      <template v-if="invoice">
        <p v-if="invoice.status === 'CREDITED'" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ t('documents.creditedNotice') }}</p>
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt class="text-slate-500">{{ t('common.date') }}</dt><dd>{{ formatDateTime(invoice.issuedAt) }}</dd></div>
          <div><dt class="text-slate-500">{{ t('invoices.customer') }}</dt><dd>{{ invoice.customerName }}<span v-if="invoice.customerTaxId" class="block text-xs text-slate-500">NUIT {{ invoice.customerTaxId }}</span></dd></div>
          <div v-if="invoice.dueDate"><dt class="text-slate-500">{{ t('documents.dueDate') }}</dt><dd>{{ formatDate(invoice.dueDate) }}</dd></div>
          <div v-if="invoice.type === 'INVOICE'"><dt class="text-slate-500">{{ t('documents.open') }}</dt><dd class="font-semibold">{{ money(invoice.open) }}</dd></div>
          <div v-if="invoice.creditOf"><dt class="text-slate-500">{{ t('documents.creditOf') }}</dt><dd><button class="text-indigo-600 hover:underline" type="button" @click="emit('open', 'INVOICE', invoice.creditOf.id)">{{ invoice.creditOf.fullNumber }}</button></dd></div>
          <div v-if="invoice.reason"><dt class="text-slate-500">{{ t('documents.reason') }}</dt><dd>{{ invoice.reason }}</dd></div>
          <div v-if="invoice.quote"><dt class="text-slate-500">{{ t('documents.fromQuote') }}</dt><dd><button class="text-indigo-600 hover:underline" type="button" @click="emit('open', 'QUOTE', invoice.quote.id)">{{ invoice.quote.fullNumber }}</button></dd></div>
          <div v-if="invoice.reservation"><dt class="text-slate-500">{{ t('invoices.reservation') }}</dt><dd><RouterLink class="text-indigo-600 hover:underline" :to="{ name: 'reservation', params: { id: invoice.reservation.id } }">{{ invoice.reservation.code }}</RouterLink></dd></div>
          <div v-if="invoice.createdBy"><dt class="text-slate-500">{{ t('documents.issuedBy') }}</dt><dd>{{ invoice.createdBy.name }}</dd></div>
        </dl>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-slate-600">
              <tr>
                <th class="px-3 py-2">{{ t('documents.description') }}</th>
                <th class="px-3 py-2 text-right">{{ t('documents.quantity') }}</th>
                <th class="px-3 py-2 text-right">{{ t('documents.price') }}</th>
                <th class="px-3 py-2 text-right">{{ t('documents.vat') }}</th>
                <th class="px-3 py-2 text-right">{{ t('common.total') }}</th>
                <th v-if="mode === 'credit' && partialCredit" class="w-36 px-3 py-2 text-right">{{ t('documents.toCredit') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="line in invoice.lines" :key="line.id">
                <td class="px-3 py-2">
                  {{ line.description }}
                  <span v-if="Number(line.creditedQuantity) > 0" class="block text-xs text-rose-600">{{ t('documents.creditedQuantity', { n: Number(line.creditedQuantity) }) }}</span>
                </td>
                <td class="px-3 py-2 text-right tabular-nums">{{ Number(line.quantity) }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ money(line.unitPrice) }}</td>
                <td class="px-3 py-2 text-right">{{ Number(line.taxRate) }}%</td>
                <td class="px-3 py-2 text-right font-medium tabular-nums">{{ money(line.grossAmount) }}</td>
                <td v-if="mode === 'credit' && partialCredit" class="px-3 py-2 text-right">
                  <input v-model="credit[line.id]" class="input w-28 text-right" inputmode="decimal" :placeholder="`0 / ${remaining(line)}`" :disabled="remaining(line) <= 0" :aria-label="t('documents.creditLine', { name: line.description })" />
                </td>
              </tr>
            </tbody>
            <tfoot class="text-sm">
              <tr><td colspan="4" class="px-3 pt-3 text-right text-slate-500">{{ t('documents.net') }}</td><td class="px-3 pt-3 text-right tabular-nums">{{ money(invoice.netTotal) }}</td></tr>
              <tr><td colspan="4" class="px-3 text-right text-slate-500">{{ t('documents.vat') }}</td><td class="px-3 text-right tabular-nums">{{ money(invoice.taxTotal) }}</td></tr>
              <tr><td colspan="4" class="px-3 pb-2 text-right font-semibold">{{ t('common.total') }}</td><td class="px-3 pb-2 text-right font-semibold tabular-nums">{{ money(invoice.grossTotal) }}</td></tr>
            </tfoot>
          </table>
        </div>
        <p v-if="invoice.notes" class="text-sm text-slate-600"><strong>{{ t('documents.notes') }}:</strong> {{ invoice.notes }}</p>

        <div v-if="invoice.creditNotes.length || invoice.receipts.length" class="grid gap-4 sm:grid-cols-2">
          <section v-if="invoice.creditNotes.length">
            <h3 class="mb-1 text-sm font-semibold">{{ t('documents.creditNotes') }}</h3>
            <ul class="space-y-1 text-sm">
              <li v-for="note in invoice.creditNotes" :key="note.id" class="flex justify-between gap-2">
                <button class="text-indigo-600 hover:underline" type="button" @click="emit('open', 'INVOICE', note.id)">{{ note.fullNumber }}</button>
                <span class="tabular-nums">− {{ money(note.grossTotal) }}</span>
              </li>
            </ul>
          </section>
          <section v-if="invoice.receipts.length">
            <h3 class="mb-1 text-sm font-semibold">{{ t('accounts.receipts') }}</h3>
            <ul class="space-y-1 text-sm">
              <li v-for="item in invoice.receipts" :key="item.id" class="flex justify-between gap-2" :class="item.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''">
                <button class="text-indigo-600 hover:underline" type="button" @click="emit('open', 'RECEIPT', item.id)">{{ item.fullNumber }}</button>
                <span class="tabular-nums">{{ money(item.amount) }}</span>
              </li>
            </ul>
          </section>
        </div>

        <div v-if="mode === 'credit'" class="space-y-2 rounded-xl border border-rose-200 bg-rose-50/50 p-3">
          <p class="text-sm text-slate-700">{{ partialCredit ? t('documents.creditPartialHint') : t('documents.creditTotalHint') }}</p>
          <div class="flex flex-wrap justify-end gap-2">
            <button class="btn-secondary" type="button" @click="mode = 'view'">{{ t('common.cancel') }}</button>
            <button class="btn-secondary" type="button" :disabled="busy" @click="issueCredit(true)">{{ t('documents.creditAll') }}</button>
            <button v-if="partialCredit" class="btn" type="button" :disabled="busy || creditTotal <= 0" @click="issueCredit(false)">{{ t('documents.creditChosen', { amount: money(creditTotal) }) }}</button>
          </div>
        </div>
        <p v-else-if="isManager && invoice.type !== 'CREDIT_NOTE' && invoice.status === 'ISSUED' && activeReceipts.length" class="text-xs text-slate-500">{{ t('documents.creditBlocked') }}</p>
      </template>

      <template v-if="receipt">
        <p v-if="receipt.status === 'CANCELLED'" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ t('documents.cancelledNotice', { reason: receipt.cancelReason ?? '' }) }}</p>
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt class="text-slate-500">{{ t('common.date') }}</dt><dd>{{ formatDateTime(receipt.issuedAt) }}</dd></div>
          <div><dt class="text-slate-500">{{ t('invoices.customer') }}</dt><dd>{{ receipt.customerName }}<span v-if="receipt.customerTaxId" class="block text-xs text-slate-500">NUIT {{ receipt.customerTaxId }}</span></dd></div>
          <div><dt class="text-slate-500">{{ t('common.total') }}</dt><dd class="font-semibold">{{ money(receipt.amount) }}</dd></div>
        </dl>
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-slate-600"><tr><th class="px-3 py-2">{{ t('documents.settled') }}</th><th class="px-3 py-2 text-right">{{ t('common.value') }}</th></tr></thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="line in receipt.lines" :key="line.id">
              <td class="px-3 py-2"><button class="text-indigo-600 hover:underline" type="button" @click="emit('open', 'INVOICE', line.invoice.id)">{{ line.invoice.fullNumber }}</button></td>
              <td class="px-3 py-2 text-right tabular-nums">{{ money(line.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <template v-if="quote">
        <p v-if="quote.status === 'CANCELLED'" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ t('documents.cancelledNotice', { reason: quote.cancelReason ?? '' }) }}</p>
        <p v-else-if="quote.expired" class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ t('documents.expiredNotice') }}</p>
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt class="text-slate-500">{{ t('common.date') }}</dt><dd>{{ formatDateTime(quote.issuedAt) }}</dd></div>
          <div><dt class="text-slate-500">{{ t('invoices.customer') }}</dt><dd>{{ quote.customerName }}<span v-if="quote.customerTaxId" class="block text-xs text-slate-500">NUIT {{ quote.customerTaxId }}</span></dd></div>
          <div><dt class="text-slate-500">{{ t('documents.validUntil') }}</dt><dd>{{ formatDate(quote.validUntil) }}</dd></div>
          <div v-if="quote.invoice"><dt class="text-slate-500">{{ t('documents.convertedTo') }}</dt><dd><button class="text-indigo-600 hover:underline" type="button" @click="emit('open', 'INVOICE', quote.invoice.id)">{{ quote.invoice.fullNumber }}</button></dd></div>
          <div v-if="quote.createdBy"><dt class="text-slate-500">{{ t('documents.issuedBy') }}</dt><dd>{{ quote.createdBy.name }}</dd></div>
        </dl>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-slate-600">
              <tr>
                <th class="px-3 py-2">{{ t('documents.description') }}</th>
                <th class="px-3 py-2 text-right">{{ t('documents.quantity') }}</th>
                <th class="px-3 py-2 text-right">{{ t('documents.price') }}</th>
                <th class="px-3 py-2 text-right">{{ t('documents.discount') }}</th>
                <th class="px-3 py-2 text-right">{{ t('documents.vat') }}</th>
                <th class="px-3 py-2 text-right">{{ t('common.total') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="line in quote.lines" :key="line.id">
                <td class="px-3 py-2">{{ line.description }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ Number(line.quantity) }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ money(line.unitPrice) }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ Number(line.discount) ? money(line.discount) : '-' }}</td>
                <td class="px-3 py-2 text-right">{{ Number(line.taxRate) }}%</td>
                <td class="px-3 py-2 text-right font-medium tabular-nums">{{ money(line.grossAmount) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr><td colspan="5" class="px-3 pt-3 text-right font-semibold">{{ t('common.total') }}</td><td class="px-3 pt-3 text-right font-semibold tabular-nums">{{ money(quote.grossTotal) }}</td></tr>
            </tfoot>
          </table>
        </div>
        <p v-if="quote.notes" class="text-sm text-slate-600"><strong>{{ t('documents.notes') }}:</strong> {{ quote.notes }}</p>

        <form v-if="mode === 'convert'" class="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3" @submit.prevent="convertQuote">
          <p class="text-sm text-slate-700">{{ t('documents.convertHint') }}</p>
          <div class="grid gap-3 md:grid-cols-4">
            <label class="block text-sm md:col-span-2"><span class="mb-1 block text-slate-600">{{ t('invoices.customer') }} *</span><input v-model="convert.customerName" class="input" maxlength="200" required /></label>
            <label class="block text-sm"><span class="mb-1 block text-slate-600">{{ t('purchases.taxId') }}</span><input v-model="convert.customerTaxId" class="input" maxlength="30" /></label>
            <label class="block text-sm"><span class="mb-1 block text-slate-600">{{ t('documents.dueDate') }}</span><input v-model="convert.dueDate" class="input" type="date" /></label>
            <label class="block text-sm md:col-span-2"><span class="mb-1 block text-slate-600">{{ t('documents.address') }}</span><input v-model="convert.customerAddress" class="input" maxlength="255" /></label>
            <label class="block text-sm md:col-span-2"><span class="mb-1 block text-slate-600">{{ t('common.email') }}</span><input v-model="convert.customerEmail" class="input" type="email" maxlength="150" /></label>
          </div>
          <div class="flex justify-end gap-2">
            <button class="btn-secondary" type="button" @click="mode = 'view'">{{ t('common.cancel') }}</button>
            <button class="btn" type="submit" :disabled="busy || !convert.customerName.trim()">{{ t('documents.convertAction') }}</button>
          </div>
        </form>
      </template>

      <div class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
        <span class="mr-auto inline-flex items-center gap-1 text-sm text-slate-600">{{ t('documents.print') }} <PaperLinks :params="printParams" :title="title" @error="error = $event" /></span>
        <template v-if="invoice && mode === 'view'">
          <button class="btn-secondary" type="button" @click="sendEmail">{{ t('common.email') }}</button>
          <button v-if="canCredit" class="btn-secondary text-rose-700" type="button" @click="startCredit">{{ t('invoices.creditNote') }}</button>
          <button v-if="invoice.type === 'INVOICE' && Number(invoice.open) > 0" class="btn" type="button" @click="emit('receive', customerKey(invoice))">{{ t('roomAccount.receive') }}</button>
        </template>
        <button v-if="receipt && isManager && receipt.status === 'ISSUED'" class="btn-secondary text-rose-700" type="button" @click="cancelReceipt">{{ t('documents.cancelReceipt') }}</button>
        <template v-if="quote && quote.status === 'OPEN' && mode === 'view'">
          <button v-if="isManager" class="btn-secondary text-rose-700" type="button" @click="cancelQuote">{{ t('documents.cancelQuote') }}</button>
          <button class="btn" type="button" @click="startConvert">{{ t('documents.convert') }}</button>
        </template>
      </div>
    </div>
  </div>
</template>

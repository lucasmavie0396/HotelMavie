<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import CashRequired from '@/components/CashRequired.vue';
import PaymentTypeSelect from '@/components/PaymentTypeSelect.vue';
import { useOwnCash } from '@/composables/cashGuard';
import { api, emailInvoice, errorMessage, openInvoicePdf } from '@/services/api';
import { printDocument, type PrintRequest } from '@/services/print';
import { usePaymentTypesStore } from '@/stores/paymentTypes';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, ChargeType, Folio, InvoiceType, Reservation, TaxRate } from '@/types';
import {
  CHARGE_TYPE_LABELS,
  formatDateTime,
  formatMoney,
  INVOICE_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
} from '@/utils/format';

const props = defineProps<{ reservation: Reservation }>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const folio = ref<Folio | null>(null);
const taxRates = ref<TaxRate[]>([]);
const registers = ref<CashRegister[]>([]);
const error = ref('');
const busy = ref(false);
const panel = ref<'charge' | 'payment' | 'invoice' | null>(null);

const isManager = computed(() => auth.user?.role !== 'RECEPTION');
const hasCash = useOwnCash(registers);
const money = (value: string | number) => formatMoney(value, hotels.currency);
const openSessions = computed(() =>
  registers.value.flatMap((register) => register.sessions.map((session) => ({ id: session.id, label: register.name }))),
);
const uninvoiced = computed(() => folio.value?.charges.filter((charge) => !charge.invoiceId) ?? []);

const charge = reactive({ description: '', type: 'EXTRA' as ChargeType, quantity: 1, unitPrice: 0, taxRateId: 0 });
const payment = reactive({ amount: 0, paymentTypeId: 0, cashSessionId: 0, reference: '' });
const paymentTypes = usePaymentTypesStore();

function print(request: PrintRequest) {
  printDocument(request).catch((e) => (error.value = errorMessage(e)));
}
const invoice = reactive({ type: 'INVOICE_RECEIPT' as InvoiceType, customerName: '', customerTaxId: '', customerAddress: '' });

async function load() {
  try {
    const [folioResponse, ratesResponse, registersResponse] = await Promise.all([
      api.get<Folio>(`/reservations/${props.reservation.id}/folio`),
      api.get<TaxRate[]>('/tax-rates', { params: { hotelId: hotels.selectedId } }),
      api.get<CashRegister[]>('/cash-registers', { params: { hotelId: hotels.selectedId } }),
    ]);
    folio.value = folioResponse.data;
    taxRates.value = ratesResponse.data.filter((rate) => rate.active);
    registers.value = registersResponse.data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
    panel.value = null;
    await load();
    emit('changed');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function openPayment() {
  payment.amount = Math.max(Number(folio.value?.balance ?? 0), 0);
  payment.reference = '';
  panel.value = 'payment';
}

function openInvoice() {
  Object.assign(invoice, {
    type: Number(folio.value?.balance ?? 0) <= 0 ? 'INVOICE_RECEIPT' : 'INVOICE',
    customerName: `${props.reservation.guest.firstName} ${props.reservation.guest.lastName}`,
    customerTaxId: '',
    customerAddress: '',
  });
  panel.value = 'invoice';
}

const addCharge = () =>
  run(() =>
    api.post(`/reservations/${props.reservation.id}/charges`, {
      ...charge,
      taxRateId: charge.taxRateId || undefined,
    }),
  ).then(() => Object.assign(charge, { description: '', quantity: 1, unitPrice: 0 }));

const addPayment = () =>
  run(() =>
    api.post(`/reservations/${props.reservation.id}/payments`, {
      amount: payment.amount,
      paymentTypeId: payment.paymentTypeId,
      cashSessionId: payment.cashSessionId || undefined,
      reference: payment.reference || undefined,
    }),
  );

const issueInvoice = () =>
  run(async () => {
    const { data } = await api.post<{ id: number }>(`/reservations/${props.reservation.id}/invoices`, {
      type: invoice.type,
      customerName: invoice.customerName || undefined,
      customerTaxId: invoice.customerTaxId || undefined,
      customerAddress: invoice.customerAddress || undefined,
    });
    await openInvoicePdf(data.id);
  });

function removeCharge(id: number) {
  if (window.confirm(t('folio.confirmDelete'))) {
    run(() => api.delete(`/charges/${id}`));
  }
}

function pdf(id: number) {
  openInvoicePdf(id).catch((e) => (error.value = errorMessage(e)));
}

onMounted(load);
defineExpose({ load });
</script>

<template>
  <div v-if="folio" class="card space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="font-semibold">{{ t('folio.title') }}</h2>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary px-3 py-1 text-xs" type="button" @click="panel = panel === 'charge' ? null : 'charge'">
          {{ t('folio.addCharge') }}
        </button>
        <button class="btn-secondary px-3 py-1 text-xs" type="button" @click="print({ document: 'STATEMENT', reservationId: reservation.id })">
          {{ t('folio.print') }}
        </button>
        <button class="btn-secondary px-3 py-1 text-xs" type="button" @click="openPayment">{{ t('folio.addPayment') }}</button>
        <button class="btn px-3 py-1 text-xs" type="button" :disabled="!uninvoiced.length" @click="openInvoice">
          {{ t('folio.invoice', { n: uninvoiced.length }) }}
        </button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <CashRequired v-if="panel === 'payment' || panel === 'invoice'" :registers="registers" />
    <p v-if="Number(folio.pendingAccommodation) > 0" class="text-xs text-slate-500">
      {{ t('folio.pendingAccommodation', { amount: money(folio.pendingAccommodation) }) }}
    </p>

    <form v-if="panel === 'charge'" class="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-6" @submit.prevent="addCharge">
      <input v-model="charge.description" class="input sm:col-span-2" :placeholder="t('common.description')" required />
      <select v-model="charge.type" class="input">
        <option v-for="(label, type) in CHARGE_TYPE_LABELS" :key="type" :value="type">{{ label }}</option>
      </select>
      <input v-model.number="charge.quantity" class="input" type="number" min="0.001" step="0.001" :placeholder="t('folio.qty')" required />
      <input v-model.number="charge.unitPrice" class="input" type="number" step="0.01" :placeholder="t('folio.priceVat')" required />
      <select v-model.number="charge.taxRateId" class="input">
        <option :value="0">{{ t('folio.noVat') }}</option>
        <option v-for="rate in taxRates" :key="rate.id" :value="rate.id">{{ rate.name }} ({{ Number(rate.rate) }}%)</option>
      </select>
      <button class="btn sm:col-span-6 sm:justify-self-end" type="submit" :disabled="busy">{{ t('folio.post') }}</button>
    </form>

    <form v-if="panel === 'payment'" class="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-5" @submit.prevent="addPayment">
      <input v-model.number="payment.amount" class="input" type="number" step="0.01" :placeholder="t('common.value')" required />
      <PaymentTypeSelect
        v-model:type-id="payment.paymentTypeId"
        v-model:cash-session-id="payment.cashSessionId"
        v-model:reference="payment.reference"
        :registers="registers"
      />
      <button class="btn" type="submit" :disabled="busy || !hasCash || !payment.paymentTypeId">
        {{ t('folio.register') }}
      </button>
      <p v-if="payment.amount < 0" class="text-xs text-slate-500 sm:col-span-5">{{ t('folio.negative') }}</p>
    </form>

    <form v-if="panel === 'invoice'" class="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-4" @submit.prevent="issueInvoice">
      <select v-model="invoice.type" class="input">
        <option value="INVOICE_RECEIPT">{{ t('folio.invoiceReceipt') }}</option>
        <option value="INVOICE">{{ t('folio.invoiceDue') }}</option>
      </select>
      <input v-model="invoice.customerName" class="input" :placeholder="t('folio.customerName')" />
      <input v-model="invoice.customerTaxId" class="input" :placeholder="t('folio.customerTaxId')" />
      <input v-model="invoice.customerAddress" class="input" :placeholder="t('folio.customerAddress')" />
      <p class="text-xs text-slate-500 sm:col-span-3">
        {{ t('folio.invoiceHint', { n: uninvoiced.length }) }}
        <template v-if="invoice.type === 'INVOICE'">{{ t('folio.invoiceDueHint') }}</template>
      </p>
      <button class="btn" type="submit" :disabled="busy || !hasCash">{{ t('folio.issue') }}</button>
    </form>

    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr>
            <th class="py-2">{{ t('folio.charge') }}</th>
            <th class="py-2 text-right">{{ t('folio.qty') }}</th>
            <th class="py-2 text-right">{{ t('common.price') }}</th>
            <th class="py-2 text-right">{{ t('folio.vat') }}</th>
            <th class="py-2 text-right">{{ t('common.total') }}</th>
            <th class="py-2">{{ t('folio.invoiceColumn') }}</th>
            <th class="py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in folio.charges" :key="item.id" class="border-b border-slate-100">
            <td class="py-2">
              {{ item.description }}
              <span class="text-xs text-slate-500">· {{ CHARGE_TYPE_LABELS[item.type] }}</span>
            </td>
            <td class="py-2 text-right">{{ Number(item.quantity) }}</td>
            <td class="py-2 text-right">{{ money(item.unitPrice) }}</td>
            <td class="py-2 text-right">{{ Number(item.taxRate) }}%</td>
            <td class="py-2 text-right">{{ money(item.total) }}</td>
            <td class="py-2">
              <button v-if="item.invoice" class="text-indigo-600 hover:underline" type="button" @click="pdf(item.invoice.id)">
                {{ item.invoice.fullNumber }}
              </button>
              <span v-if="item.onCustomerAccount" class="ml-1 rounded bg-sky-100 px-1 text-xs text-sky-800">{{ t('folio.customerAccount') }}</span>
              <span v-else class="text-slate-400">-</span>
            </td>
            <td class="py-2 text-right">
              <button
                v-if="isManager && !item.invoiceId"
                class="text-xs text-rose-600 hover:underline"
                type="button"
                @click="removeCharge(item.id)"
              >
                {{ t('common.delete') }}
              </button>
            </td>
          </tr>
          <tr v-for="item in folio.payments" :key="`p${item.id}`" class="border-b border-slate-100 text-emerald-700">
            <td class="py-2" colspan="4">
              {{ item.id === reservation.depositPaymentId ? t('folio.deposit') : t('folio.payment') }} · {{ paymentTypes.byId(item.paymentTypeId)?.name ?? PAYMENT_METHOD_LABELS[item.method] }}
              <span class="text-xs text-slate-500">{{ item.reference ?? '' }} {{ formatDateTime(item.createdAt) }}</span>
              <button class="ml-2 text-xs text-indigo-600 hover:underline" type="button" @click="print({ document: 'PAYMENT', paymentId: item.id })">
                {{ t('folio.proof') }}
              </button>
            </td>
            <td class="py-2 text-right">-{{ money(item.amount) }}</td>
            <td colspan="2"></td>
          </tr>
          <tr v-if="!folio.charges.length && !folio.payments.length">
            <td colspan="7" class="py-4 text-center text-slate-500">{{ t('folio.empty') }}</td>
          </tr>
        </tbody>
        <tfoot class="font-semibold">
          <tr v-if="Number(folio.customerAccountTotal) > 0" class="text-sky-800">
            <td colspan="4" class="pt-3 text-right font-normal">{{ t('folio.invoicedDue') }}</td>
            <td class="pt-3 text-right font-normal">{{ money(folio.customerAccountTotal) }}</td>
            <td colspan="2"></td>
          </tr>
          <tr>
            <td colspan="4" class="pt-3 text-right">{{ t('folio.balance') }}</td>
            <td class="pt-3 text-right" :class="Number(folio.balance) > 0 ? 'text-rose-600' : 'text-emerald-700'">
              {{ money(folio.balance) }}
            </td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div v-if="folio.invoices.length" class="space-y-1 text-sm">
      <h3 class="font-semibold text-slate-600">{{ t('folio.documents') }}</h3>
      <div v-for="doc in folio.invoices" :key="doc.id" class="flex items-center gap-3">
        <button class="text-indigo-600 hover:underline" type="button" @click="pdf(doc.id)">{{ doc.fullNumber }}</button>
        <span>{{ INVOICE_TYPE_LABELS[doc.type] }}</span>
        <span>{{ money(doc.grossTotal) }}</span>
        <span v-if="doc.status === 'CREDITED'" class="text-xs text-rose-600">{{ t('folio.credited') }}</span>
        <button
          class="text-xs text-indigo-600 hover:underline"
          type="button"
          @click="emailInvoice(doc.id, doc.fullNumber).catch((e) => (error = errorMessage(e)))"
        >
          {{ t('folio.sendEmail') }}
        </button>
        <button class="text-xs text-indigo-600 hover:underline" type="button" @click="print({ document: 'INVOICE', invoiceId: doc.id })">
          {{ t('folio.printTicket') }}
        </button>
      </div>
    </div>
  </div>
</template>

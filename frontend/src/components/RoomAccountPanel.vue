<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import CashRequired from '@/components/CashRequired.vue';
import PaymentTypeSelect from '@/components/PaymentTypeSelect.vue';
import { useOwnCash } from '@/composables/cashGuard';
import { api, errorMessage } from '@/services/api';
import { printDocument, type PrintRequest } from '@/services/print';
import { useHotelsStore } from '@/stores/hotels';
import { usePaymentTypesStore } from '@/stores/paymentTypes';
import type { CashRegister, Folio, Reservation } from '@/types';
import { CHARGE_TYPE_LABELS, formatDateTime, formatMoney, PAYMENT_METHOD_LABELS } from '@/utils/format';

const { t } = useI18n();
const hotels = useHotelsStore();
const inHouse = ref<Reservation[]>([]);
const registers = ref<CashRegister[]>([]);
const selectedId = ref(0);
const folio = ref<Folio | null>(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const pay = reactive({ amount: 0, paymentTypeId: 0, cashSessionId: 0, reference: '', invoice: true, customerTaxId: '' });
const paymentTypes = usePaymentTypesStore();
const hasCash = useOwnCash(registers);

const money = (value: string | number) => formatMoney(value, hotels.currency);
const selected = computed(() => inHouse.value.find((reservation) => reservation.id === selectedId.value) ?? null);
const uninvoiced = computed(() => folio.value?.charges.filter((charge) => !charge.invoiceId) ?? []);
const uninvoicedTotal = computed(() => uninvoiced.value.reduce((sum, charge) => sum + Number(charge.total), 0));
const openSessions = computed(() =>
  registers.value.flatMap((register) => register.sessions.map((session) => ({ id: session.id, label: register.name }))),
);

async function load() {
  error.value = '';
  try {
    const params = { hotelId: hotels.selectedId };
    const [r, c] = await Promise.all([
      api.get<Reservation[]>('/reservations', { params: { ...params, status: 'CHECKED_IN' } }),
      api.get<CashRegister[]>('/cash-registers', { params }),
    ]);
    inHouse.value = r.data;
    registers.value = c.data;
    if (!inHouse.value.some((reservation) => reservation.id === selectedId.value)) {
      selectedId.value = inHouse.value[0]?.id ?? 0;
    }
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function loadFolio() {
  folio.value = null;
  if (!selectedId.value) return;
  try {
    folio.value = (await api.get<Folio>(`/reservations/${selectedId.value}/folio`)).data;
    Object.assign(pay, {
      amount: Math.max(Number(folio.value.balance), 0),
      reference: '',
      invoice: uninvoiced.value.length > 0,
      customerTaxId: '',
    });
  } catch (e) {
    error.value = errorMessage(e);
  }
}

watch(selectedId, loadFolio);

async function receive() {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    let invoiceId: number | null = null;
    if (pay.invoice && uninvoiced.value.length) {
      const { data } = await api.post<{ id: number }>(`/reservations/${selectedId.value}/invoices`, {
        type: 'INVOICE_RECEIPT',
        chargeIds: uninvoiced.value.map((charge) => charge.id),
        customerTaxId: pay.customerTaxId || undefined,
      });
      invoiceId = data.id;
    }
    const { data: payment } = await api.post<{ id: number }>(`/reservations/${selectedId.value}/payments`, {
      amount: pay.amount,
      paymentTypeId: pay.paymentTypeId,
      cashSessionId: pay.cashSessionId || undefined,
      reference: pay.reference || undefined,
    });
    if (invoiceId) await printDocument({ document: 'INVOICE', invoiceId });
    await printDocument({ document: 'PAYMENT', paymentId: payment.id });
    notice.value = invoiceId ? t('roomAccount.paidInvoiced') : t('roomAccount.paid');
    await loadFolio();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function print(request: PrintRequest) {
  printDocument(request)
    .then((message) => (notice.value = message))
    .catch((e) => (error.value = errorMessage(e)));
}

onMounted(async () => {
  await load();
  await loadFolio();
});
defineExpose({ load });
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[260px_1fr]">
    <div class="card space-y-2 p-3">
      <h2 class="text-sm font-semibold text-slate-600">{{ t('roomAccount.occupied') }}</h2>
      <button
        v-for="reservation in inHouse"
        :key="reservation.id"
        type="button"
        class="w-full rounded-md border px-3 py-2 text-left text-sm"
        :class="selectedId === reservation.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'"
        @click="selectedId = reservation.id"
      >
        <span class="font-medium">{{ t('dashboard.room', { number: reservation.room.number }) }}</span>
        <span class="block text-slate-500">{{ reservation.guest.firstName }} {{ reservation.guest.lastName }}</span>
      </button>
      <p v-if="!inHouse.length" class="text-sm text-slate-500">{{ t('roomAccount.none') }}</p>
    </div>

    <div v-if="selected && folio" class="card space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">{{ t('dashboard.room', { number: selected.room.number }) }} · {{ selected.guest.firstName }} {{ selected.guest.lastName }}</h2>
        <div class="flex gap-2">
          <button class="btn-secondary" type="button" @click="print({ document: 'STATEMENT', reservationId: selected.id })">{{ t('folio.print') }}</button>
          <RouterLink :to="{ name: 'reservation', params: { id: selected.id } }" class="btn-secondary">{{ t('roomAccount.openReservation') }}</RouterLink>
        </div>
      </div>

      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

      <div class="max-h-80 overflow-y-auto">
        <table class="w-full text-left text-sm">
          <tbody>
            <tr v-for="charge in folio.charges" :key="charge.id" class="border-b border-slate-100">
              <td class="py-1.5">
                {{ Number(charge.quantity) }} x {{ charge.description }}
                <span class="text-xs text-slate-500">· {{ CHARGE_TYPE_LABELS[charge.type] }}</span>
              </td>
              <td class="py-1.5 text-xs">
                <button v-if="charge.invoice" class="text-indigo-600 hover:underline" type="button" @click="print({ document: 'INVOICE', invoiceId: charge.invoice.id })">
                  {{ charge.invoice.fullNumber }}
                </button>
                <span v-else class="text-amber-700">{{ t('roomAccount.uninvoiced') }}</span>
              </td>
              <td class="py-1.5 text-right">{{ money(charge.total) }}</td>
            </tr>
            <tr v-for="payment in folio.payments" :key="`p${payment.id}`" class="border-b border-slate-100 text-emerald-700">
              <td class="py-1.5">{{ t('folio.payment') }} · {{ paymentTypes.byId(payment.paymentTypeId)?.name ?? PAYMENT_METHOD_LABELS[payment.method] }} <span class="text-xs text-slate-500">{{ formatDateTime(payment.createdAt) }}</span></td>
              <td class="py-1.5 text-xs">
                <button class="text-indigo-600 hover:underline" type="button" @click="print({ document: 'PAYMENT', paymentId: payment.id })">{{ t('folio.proof') }}</button>
              </td>
              <td class="py-1.5 text-right">-{{ money(payment.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold">
        {{ t('folio.balance') }} <span :class="Number(folio.balance) > 0 ? 'text-rose-600' : 'text-emerald-700'">{{ money(folio.balance) }}</span>
      </p>

      <form class="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-2" @submit.prevent="receive">
        <h3 class="text-sm font-semibold sm:col-span-2">{{ t('roomAccount.receive') }}</h3>
        <CashRequired class="sm:col-span-2" :registers="registers" />
        <input v-model.number="pay.amount" class="input" type="number" min="0.01" step="0.01" :aria-label="t('common.value')" required />
        <PaymentTypeSelect v-model:type-id="pay.paymentTypeId" v-model:cash-session-id="pay.cashSessionId" v-model:reference="pay.reference" :registers="registers" />
        <label class="flex items-center gap-2 text-sm sm:col-span-2" :class="uninvoiced.length ? '' : 'text-slate-400'">
          <input v-model="pay.invoice" type="checkbox" :disabled="!uninvoiced.length" />
          {{ t('roomAccount.issue', { n: uninvoiced.length, amount: money(uninvoicedTotal) }) }}
        </label>
        <input v-if="pay.invoice && uninvoiced.length" v-model="pay.customerTaxId" class="input" :placeholder="t('pos.taxId')" />
        <button class="btn sm:col-start-2" type="submit" :disabled="busy || !hasCash || !pay.paymentTypeId">
          {{ t('roomAccount.receiveAmount', { amount: money(pay.amount || 0) }) }}
        </button>
      </form>
    </div>
    <p v-else class="text-sm text-slate-500">{{ t('roomAccount.pick') }}</p>
  </div>
</template>

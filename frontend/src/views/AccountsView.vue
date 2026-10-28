<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage, openInvoicePdf } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, CustomerAccount, OpenInvoice, PaymentMethod, ReceiptDoc } from '@/types';
import { formatDate, formatDateTime, formatMoney, PAYMENT_METHOD_LABELS } from '@/utils/format';

const auth = useAuthStore();
const hotels = useHotelsStore();
const accounts = ref<CustomerAccount[]>([]);
const receipts = ref<ReceiptDoc[]>([]);
const registers = ref<CashRegister[]>([]);
const selected = ref<CustomerAccount | null>(null);
const openInvoices = ref<OpenInvoice[]>([]);
const amounts = reactive<Record<number, number>>({});
const payment = reactive({ method: 'TRANSFER' as PaymentMethod, cashSessionId: 0, reference: '' });
const error = ref('');
const busy = ref(false);

const isManager = computed(() => auth.user?.role !== 'RECEPTION');
const money = (value: string | number) => formatMoney(value, hotels.currency);
const total = computed(() => openInvoices.value.reduce((sum, invoice) => sum + Number(amounts[invoice.id] || 0), 0));
const totalOpen = computed(() => accounts.value.reduce((sum, account) => sum + Number(account.open), 0));
const openSessions = computed(() =>
  registers.value.flatMap((register) => register.sessions.map((session) => ({ id: session.id, label: register.name }))),
);

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
    payment.cashSessionId = openSessions.value[0]?.id ?? 0;
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
      method: payment.method,
      cashSessionId: payment.method === 'CASH' ? payment.cashSessionId || undefined : undefined,
      reference: payment.reference || undefined,
      lines,
    });
    selected.value = null;
    payment.reference = '';
    await load();
    await openInvoicePdf(data.id, 'receipts');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function cancel(receipt: ReceiptDoc) {
  const reason = window.prompt(`Motivo da anulacao de ${receipt.fullNumber}:`);
  if (!reason) return;
  try {
    await api.post(`/receipts/${receipt.id}/cancel`, {
      reason,
      cashSessionId: receipt.method === 'CASH' ? openSessions.value[0]?.id : undefined,
    });
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function pdf(id: number) {
  openInvoicePdf(id, 'receipts').catch((e) => (error.value = errorMessage(e)));
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <h1 class="text-2xl font-semibold">Contas correntes</h1>
      <p class="text-sm text-slate-600">Total em divida: <strong>{{ money(totalOpen) }}</strong></p>
    </div>

    <p class="text-sm text-slate-600">
      As faturas "a pagar" (FT) ficam aqui ate serem liquidadas com recibo. As faturas-recibo (FR) ja estao pagas.
    </p>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">Cliente</th>
            <th class="px-4 py-3">NIF</th>
            <th class="px-4 py-3 text-right">Faturas</th>
            <th class="px-4 py-3">Mais antiga</th>
            <th class="px-4 py-3 text-right">Em divida</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="account in accounts" :key="account.customerKey" class="border-b border-slate-100">
            <td class="px-4 py-3 font-medium">{{ account.customerName }}</td>
            <td class="px-4 py-3">{{ account.customerTaxId ?? '-' }}</td>
            <td class="px-4 py-3 text-right">{{ account.invoices }}</td>
            <td class="px-4 py-3" :class="daysSince(account.oldest) > 30 ? 'text-rose-700' : ''">
              {{ formatDate(account.oldest) }} ({{ daysSince(account.oldest) }} dias)
            </td>
            <td class="px-4 py-3 text-right font-semibold">{{ money(account.open) }}</td>
            <td class="px-4 py-3 text-right">
              <button class="btn px-3 py-1 text-xs" type="button" @click="select(account)">Receber</button>
            </td>
          </tr>
          <tr v-if="!accounts.length">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">Nao ha faturas por receber</td>
          </tr>
        </tbody>
      </table>
    </div>

    <form v-if="selected" class="card space-y-4" @submit.prevent="issue">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">Recibo para {{ selected.customerName }}</h2>
        <button class="text-sm text-slate-500 hover:underline" type="button" @click="selected = null">Fechar</button>
      </div>
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr><th class="py-2">Fatura</th><th class="py-2">Data</th><th class="py-2 text-right">Total</th><th class="py-2 text-right">Em divida</th><th class="py-2 text-right">A receber</th></tr>
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
      <div class="grid gap-3 sm:grid-cols-4">
        <select v-model="payment.method" class="input">
          <option v-for="(label, method) in PAYMENT_METHOD_LABELS" :key="method" :value="method">{{ label }}</option>
        </select>
        <select v-if="payment.method === 'CASH'" v-model.number="payment.cashSessionId" class="input" required>
          <option v-if="!openSessions.length" :value="0" disabled>Nenhuma caixa aberta</option>
          <option v-for="session in openSessions" :key="session.id" :value="session.id">Caixa {{ session.label }}</option>
        </select>
        <input v-model="payment.reference" class="input" placeholder="Referencia (n.o da transferencia...)" />
        <button class="btn" type="submit" :disabled="busy || total <= 0">Emitir recibo de {{ money(total) }}</button>
      </div>
    </form>

    <div class="card overflow-x-auto p-0">
      <h2 class="px-4 pt-4 font-semibold">Recibos emitidos</h2>
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr>
            <th class="px-4 py-2">Numero</th>
            <th class="px-4 py-2">Data</th>
            <th class="px-4 py-2">Cliente</th>
            <th class="px-4 py-2">Faturas</th>
            <th class="px-4 py-2">Meio</th>
            <th class="px-4 py-2 text-right">Valor</th>
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
            <td class="px-4 py-2">{{ PAYMENT_METHOD_LABELS[item.method] }}</td>
            <td class="px-4 py-2 text-right">{{ money(item.amount) }}</td>
            <td class="px-4 py-2 text-right">
              <button
                v-if="isManager && item.status === 'ISSUED'"
                class="text-xs text-rose-600 hover:underline"
                type="button"
                @click="cancel(item)"
              >
                Anular
              </button>
            </td>
          </tr>
          <tr v-if="!receipts.length"><td colspan="7" class="px-4 py-4 text-center text-slate-500">Sem recibos</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

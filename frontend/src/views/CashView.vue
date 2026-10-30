<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { previewPdfFrom, printDocument, printPdfFrom } from '@/services/print';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, CashSession, CashSessionDetail, PaperWidth } from '@/types';
import { formatDateTime, formatMoney, PAYMENT_METHOD_LABELS } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const registers = ref<CashRegister[]>([]);
const detail = ref<CashSessionDetail | null>(null);
const history = ref<CashSession[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);

const newRegister = ref('');
const opening = reactive<Record<number, number>>({});
const movement = reactive({ type: 'OUT' as 'IN' | 'OUT', amount: 0, description: '' });
const closing = reactive({ countedAmount: 0, notes: '' });

const isManager = computed(() => auth.user?.role !== 'RECEPTION');
const money = (value: string | number) => formatMoney(value, hotels.currency);

async function load() {
  error.value = '';
  try {
    registers.value = (await api.get<CashRegister[]>('/cash-registers', { params: { hotelId: hotels.selectedId } })).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function showSession(id: number) {
  try {
    detail.value = (await api.get<CashSessionDetail>(`/cash-sessions/${id}`)).data;
    closing.countedAmount = Number(detail.value.expected);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function showHistory(registerId: number) {
  history.value = (await api.get<CashSession[]>(`/cash-registers/${registerId}/sessions`)).data;
}

const createRegister = () =>
  run(() => api.post('/cash-registers', { hotelId: hotels.selectedId, name: newRegister.value })).then(() => {
    newRegister.value = '';
  });

const openRegister = (id: number) =>
  run(async () => {
    const { data } = await api.post<CashSession>(`/cash-registers/${id}/open`, { openingAmount: opening[id] ?? 0 });
    await showSession(data.id);
  });

const addMovement = () =>
  run(async () => {
    await api.post(`/cash-sessions/${detail.value!.id}/movements`, movement);
    Object.assign(movement, { amount: 0, description: '' });
    await showSession(detail.value!.id);
  });

const closeSession = () =>
  run(async () => {
    if (!window.confirm(t('cash.confirmClose'))) {
      return;
    }
    await api.post(`/cash-sessions/${detail.value!.id}/close`, closing);
    await showSession(detail.value!.id);
    await previewCloseDocument(detail.value!.id);
  });

const closeDocument = (sessionId: number) => ({ document: 'REPORT' as const, report: 'cash-close', sessionId, hotelId: hotels.selectedId });

async function previewCloseDocument(sessionId: number, papers: PaperWidth[] = ['A4', 'MM80']) {
  for (const paper of papers) {
    await previewPdfFrom('/print/pdf', { ...closeDocument(sessionId), paper }, `${t('cash.document')} · ${paper === 'A4' ? 'A4' : '80 mm'}`, paper);
  }
}

const previewClose = (paper: PaperWidth) => run(() => previewCloseDocument(detail.value!.id, [paper]));
const printCloseA4 = () => run(() => printPdfFrom('/print/pdf', { ...closeDocument(detail.value!.id), paper: 'A4' }));
const printClose80 = () =>
  run(async () => {
    notice.value = await printDocument(closeDocument(detail.value!.id));
  });

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="cash" :subtitle="t('cash.subtitle')" />

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="register in registers" :key="register.id" class="card space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">{{ register.name }}</h2>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-medium"
            :class="register.sessions.length ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'"
          >
            {{ register.sessions.length ? t('cash.open') : t('cash.closed') }}
          </span>
        </div>
        <template v-if="register.sessions[0]">
          <p class="text-sm text-slate-600">
            {{ t('cash.openedBy', { name: register.sessions[0].openedBy?.name ?? '-', date: formatDateTime(register.sessions[0].openedAt) }) }}
          </p>
          <button class="btn w-full" type="button" @click="showSession(register.sessions[0].id)">{{ t('cash.view') }}</button>
        </template>
        <form v-else class="flex gap-2" @submit.prevent="openRegister(register.id)">
          <input v-model.number="opening[register.id]" class="input" type="number" min="0" step="0.01" :placeholder="t('cash.float')" />
          <button class="btn whitespace-nowrap" type="submit" :disabled="busy">{{ t('cash.openAction') }}</button>
        </form>
        <button class="text-xs text-indigo-600 hover:underline" type="button" @click="showHistory(register.id)">{{ t('stock.history') }}</button>
      </div>

      <form v-if="isManager" class="card flex items-end gap-2" @submit.prevent="createRegister">
        <label class="flex-1 text-sm">
          {{ t('cash.new') }}
          <input v-model="newRegister" class="input" :placeholder="t('cash.newExample')" required />
        </label>
        <button class="btn" type="submit" :disabled="busy">{{ t('common.create') }}</button>
      </form>
    </div>

    <div v-if="detail" class="card space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">
          {{ detail.register.name }} · {{ t('cash.session', { date: formatDateTime(detail.openedAt) }) }}
          <span v-if="detail.closedAt" class="text-sm font-normal text-slate-500">({{ t('cash.closedAt', { date: formatDateTime(detail.closedAt) }) }})</span>
        </h2>
        <button class="text-sm text-slate-500 hover:underline" type="button" @click="detail = null">{{ t('cash.closePanel') }}</button>
      </div>

      <div class="grid gap-4 sm:grid-cols-4">
        <div><p class="text-xs text-slate-500">{{ t('cash.openingAmount') }}</p><p class="font-semibold">{{ money(detail.openingAmount) }}</p></div>
        <div><p class="text-xs text-slate-500">{{ t('cash.cashReceived') }}</p><p class="font-semibold">{{ money(detail.payments.reduce((s, p) => s + Number(p.amount), 0)) }}</p></div>
        <div><p class="text-xs text-slate-500">{{ t('cash.expected') }}</p><p class="text-lg font-semibold">{{ money(detail.expected) }}</p></div>
        <div v-if="detail.closedAt">
          <p class="text-xs text-slate-500">{{ t('cash.countedDifference') }}</p>
          <p class="font-semibold" :class="Number(detail.difference) === 0 ? 'text-emerald-700' : 'text-rose-600'">
            {{ money(detail.countedAmount ?? 0) }} · {{ money(detail.difference ?? 0) }}
          </p>
        </div>
      </div>

      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr><th class="py-2">{{ t('cash.time') }}</th><th class="py-2">{{ t('cash.movement') }}</th><th class="py-2 text-right">{{ t('common.value') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="payment in detail.payments" :key="`p${payment.id}`" class="border-b border-slate-100">
            <td class="py-2">{{ formatDateTime(payment.createdAt) }}</td>
            <td class="py-2">
              {{ PAYMENT_METHOD_LABELS[payment.method] }}
              <RouterLink
                v-if="payment.reservation"
                :to="{ name: 'reservation', params: { id: payment.reservation.id } }"
                class="text-indigo-600 hover:underline"
              >
                {{ payment.reservation.code }}
              </RouterLink>
            </td>
            <td class="py-2 text-right">{{ money(payment.amount) }}</td>
          </tr>
          <tr v-for="item in detail.movements" :key="`m${item.id}`" class="border-b border-slate-100">
            <td class="py-2">{{ formatDateTime(item.createdAt) }}</td>
            <td class="py-2">{{ item.type === 'IN' ? t('cash.in') : t('cash.out') }} · {{ item.description }}</td>
            <td class="py-2 text-right" :class="item.type === 'OUT' ? 'text-rose-600' : ''">
              {{ item.type === 'OUT' ? '-' : '' }}{{ money(item.amount) }}
            </td>
          </tr>
        </tbody>
      </table>

      <div class="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-100">
        <div class="mr-auto">
          <p class="font-semibold">{{ t('cash.document') }}</p>
          <p class="text-xs text-slate-500">{{ detail.closedAt ? t('cash.documentHint') : t('cash.documentPartial') }}</p>
        </div>
        <button class="btn-secondary" type="button" :disabled="busy" @click="previewClose('A4')">{{ t('cash.viewA4') }}</button>
        <button class="btn-secondary" type="button" :disabled="busy" @click="previewClose('MM80')">{{ t('cash.view80') }}</button>
        <button class="btn-secondary" type="button" :disabled="busy" @click="printCloseA4">{{ t('reports.printA4') }}</button>
        <button class="btn" type="button" :disabled="busy" @click="printClose80">{{ t('reports.print80') }}</button>
      </div>

      <template v-if="!detail.closedAt">
        <form class="grid gap-3 sm:grid-cols-4" @submit.prevent="addMovement">
          <select v-model="movement.type" class="input">
            <option value="OUT">{{ t('cash.outOption') }}</option>
            <option value="IN">{{ t('cash.inOption') }}</option>
          </select>
          <input v-model.number="movement.amount" class="input" type="number" min="0.01" step="0.01" :placeholder="t('common.value')" required />
          <input v-model="movement.description" class="input" :placeholder="t('common.description')" required />
          <button class="btn-secondary" type="submit" :disabled="busy">{{ t('cash.addMovement') }}</button>
        </form>
        <form class="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-4" @submit.prevent="closeSession">
          <label class="text-sm">
            {{ t('cash.counted') }}
            <input v-model.number="closing.countedAmount" class="input" type="number" min="0" step="0.01" required />
          </label>
          <input v-model="closing.notes" class="input self-end sm:col-span-2" :placeholder="t('cash.closeNotes')" />
          <button class="btn self-end" type="submit" :disabled="busy">{{ t('cash.close') }}</button>
        </form>
      </template>
    </div>

    <div v-if="history.length" class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('cash.opening') }}</th>
            <th class="px-4 py-3">{{ t('cash.closing') }}</th>
            <th class="px-4 py-3 text-right">{{ t('cash.expectedShort') }}</th>
            <th class="px-4 py-3 text-right">{{ t('stock.counted') }}</th>
            <th class="px-4 py-3 text-right">{{ t('stock.difference') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="session in history"
            :key="session.id"
            class="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
            @click="showSession(session.id)"
          >
            <td class="px-4 py-3">{{ formatDateTime(session.openedAt) }} · {{ session.openedBy?.name }}</td>
            <td class="px-4 py-3">{{ session.closedAt ? `${formatDateTime(session.closedAt)} · ${session.closedBy?.name}` : t('cash.open') }}</td>
            <td class="px-4 py-3 text-right">{{ session.expectedAmount ? money(session.expectedAmount) : '-' }}</td>
            <td class="px-4 py-3 text-right">{{ session.countedAmount ? money(session.countedAmount) : '-' }}</td>
            <td class="px-4 py-3 text-right">{{ session.difference ? money(session.difference) : '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

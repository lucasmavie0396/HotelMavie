<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import ExportList from '@/components/ExportList.vue';
import PaymentTypeSelect from '@/components/PaymentTypeSelect.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { askText } from '@/services/dialog';
import { previewPdfFrom } from '@/services/print';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, Guest } from '@/types';
import { formatDateTime, formatMoney } from '@/utils/format';

interface EventCard {
  id: number;
  number: string;
  holder: string | null;
  guestId: number | null;
  guest: { id: number; firstName: string; lastName: string } | null;
  balance: string;
  active: boolean;
  createdAt: string;
  lastMovementAt?: string | null;
}

interface CardMovement {
  id: number;
  type: string;
  amount: string;
  balanceAfter: string;
  reason: string | null;
  createdAt: string;
  createdBy: { name: string } | null;
  loadPayment: { method: string; paymentType: { name: string } | null } | null;
}

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const cards = ref<EventCard[]>([]);
const guests = ref<Guest[]>([]);
const registers = ref<CashRegister[]>([]);
const search = ref('');
const lookupNumber = ref('');
const current = ref<EventCard | null>(null);
const movements = ref<{ items: CardMovement[]; credit: string; debit: string } | null>(null);
const range = reactive({ from: '', to: '' });
const error = ref('');
const notice = ref('');
const busy = ref(false);
const mode = ref<'' | 'register' | 'topup' | 'transfer' | 'discharge'>('');
const selected = ref<number[]>([]);
const isManager = computed(() => auth.isManager);
const money = (value: string | number) => formatMoney(value, hotels.currency);
const holderOf = (card: EventCard) => (card.guest ? `${card.guest.firstName} ${card.guest.lastName}` : (card.holder ?? '-'));
const key = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const totalBalance = computed(() => cards.value.reduce((sum, card) => sum + Number(card.balance), 0));

const register = reactive({ number: '', holder: '', guestId: 0, amount: 0, paymentTypeId: 0, cashSessionId: 0, reference: '', idempotencyKey: '' });
const topup = reactive({ amount: 0, paymentTypeId: 0, cashSessionId: 0, reference: '', idempotencyKey: '' });
const transfer = reactive({ toNumber: '', block: true, reason: '' });
const discharge = reactive({ includeGuests: false, refund: true, paymentTypeId: 0, cashSessionId: 0, reference: '', reason: '', cards: [] as EventCard[], total: '0', left: 0 });

async function load() {
  try {
    const params = { hotelId: hotels.selectedId };
    const [c, r] = await Promise.all([
      api.get<EventCard[]>('/event-cards', { params: { ...params, q: search.value || undefined } }),
      api.get<CashRegister[]>('/cash-registers', { params }),
    ]);
    cards.value = c.data;
    registers.value = r.data;
    if (!auth.isCashier && !guests.value.length) guests.value = (await api.get<Guest[]>('/guests', { params })).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: () => Promise<unknown>, message: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    notice.value = message;
    await load();
    if (current.value) await open(current.value.id);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function open(id: number) {
  const [card, list] = await Promise.all([
    api.get<EventCard>(`/event-cards/${id}`),
    api.get<{ items: CardMovement[]; credit: string; debit: string }>(`/event-cards/${id}/movements`, { params: { from: range.from || undefined, to: range.to || undefined } }),
  ]);
  current.value = card.data;
  movements.value = list.data;
}

async function lookup() {
  error.value = '';
  if (!lookupNumber.value.trim()) return;
  try {
    const { data } = await api.get<EventCard>('/event-cards/lookup', { params: { hotelId: hotels.selectedId, number: lookupNumber.value } });
    lookupNumber.value = '';
    mode.value = '';
    await open(data.id);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function startRegister() {
  Object.assign(register, { number: '', holder: '', guestId: 0, amount: 0, paymentTypeId: 0, cashSessionId: 0, reference: '', idempotencyKey: key() });
  mode.value = 'register';
}

const saveRegister = () =>
  run(async () => {
    const { data } = await api.post<EventCard>('/event-cards', {
      hotelId: hotels.selectedId,
      number: register.number,
      holder: register.holder || undefined,
      guestId: register.guestId || undefined,
      amount: register.amount || undefined,
      paymentTypeId: register.amount ? register.paymentTypeId : undefined,
      cashSessionId: register.cashSessionId || undefined,
      reference: register.reference || undefined,
      idempotencyKey: register.idempotencyKey,
    });
    mode.value = '';
    current.value = data;
  }, t('cards.registered'));

function startTopup() {
  Object.assign(topup, { amount: 0, paymentTypeId: 0, cashSessionId: 0, reference: '', idempotencyKey: key() });
  mode.value = 'topup';
}

const saveTopup = () =>
  run(async () => {
    const { data } = await api.post<{ movementId: number }>(`/event-cards/${current.value!.id}/topup`, {
      amount: topup.amount,
      paymentTypeId: topup.paymentTypeId,
      cashSessionId: topup.cashSessionId || undefined,
      reference: topup.reference || undefined,
      idempotencyKey: topup.idempotencyKey,
    });
    mode.value = '';
    await receipt(data.movementId);
  }, t('cards.toppedUp'));

const receipt = (movementId: number) =>
  previewPdfFrom(`/event-cards/movements/${movementId}/receipt`, { paper: 'MM80' }, t('cards.receipt'), 'MM80').catch((e) => (error.value = errorMessage(e)));

async function toggleActive() {
  const card = current.value!;
  const reason = card.active ? await askText({ title: t('cards.block'), message: t('cards.blockPrompt'), required: true, danger: true, confirmLabel: t('cards.block') }) : '';
  if (reason === null) return;
  await run(() => api.post(`/event-cards/${card.id}/active`, { active: !card.active, reason: reason || undefined }), card.active ? t('cards.blocked') : t('cards.unblocked'));
}

const setGuest = (guestId: number) => run(() => api.post(`/event-cards/${current.value!.id}/guest`, { guestId: guestId || null }), t('cards.guestSaved'));

const saveTransfer = () =>
  run(async () => {
    await api.post(`/event-cards/${current.value!.id}/transfer`, { toNumber: transfer.toNumber, block: transfer.block, reason: transfer.reason });
    mode.value = '';
  }, t('cards.transferred'));

async function refund() {
  const value = await askText({ title: t('cards.refund'), message: t('cards.refundPrompt'), required: true, confirmLabel: t('cards.refund') });
  if (!value) return;
  const [amount, ...rest] = value.split(' ');
  const reason = rest.join(' ').trim() || t('cards.refundDefault');
  await run(() => api.post(`/event-cards/${current.value!.id}/refund`, { amount: Number(amount.replace(',', '.')), reason }), t('cards.refunded'));
}

async function startDischarge() {
  mode.value = 'discharge';
  await loadDischarge();
}

async function loadDischarge() {
  try {
    const { data } = await api.get<{ cards: EventCard[]; total: string; guestCardsLeft: number }>('/event-cards/discharge/balances', {
      params: { hotelId: hotels.selectedId, includeGuests: discharge.includeGuests ? 'true' : undefined },
    });
    Object.assign(discharge, { cards: data.cards, total: data.total, left: data.guestCardsLeft });
  } catch (e) {
    error.value = errorMessage(e);
  }
}

const saveDischarge = () =>
  run(async () => {
    await api.post('/event-cards/discharge', {
      hotelId: hotels.selectedId,
      cards: discharge.cards.map((card) => ({ id: card.id, balance: Number(card.balance) })),
      refund: discharge.refund,
      paymentTypeId: discharge.refund ? discharge.paymentTypeId : undefined,
      cashSessionId: discharge.cashSessionId || undefined,
      reference: discharge.reference || undefined,
      reason: discharge.reason,
    });
    mode.value = '';
  }, t('cards.discharged'));

const printLabels = (ids: number[]) =>
  api
    .post<Blob>('/event-cards/labels', { ids }, { responseType: 'blob' })
    .then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    })
    .catch((e) => (error.value = errorMessage(e)));

const MOVEMENTS = ['LOAD', 'TOPUP', 'PAYMENT', 'REFUND', 'DISCHARGE', 'TRANSFER_OUT', 'TRANSFER_IN', 'GUEST_CHANGE'];
const movementLabel = (type: string) => (MOVEMENTS.includes(type) ? t(`cards.movements.${type}`) : type);
const exportColumns = () => [t('cards.number'), t('cards.holder'), t('cards.balance'), t('common.status'), t('cards.lastMovement')];
const exportRows = () => cards.value.map((card) => [card.number, holderOf(card), Number(card.balance), card.active ? t('common.active') : t('cards.blockedState'), card.lastMovementAt ? formatDateTime(card.lastMovementAt) : '']);

onMounted(load);
</script>

<template>
  <section class="space-y-4">
    <PageHeader section="cards" :subtitle="t('cards.subtitle')">
      <button class="btn" type="button" @click="startRegister">{{ t('cards.register') }}</button>
      <button v-if="isManager" class="btn-secondary" type="button" @click="startDischarge">{{ t('cards.discharge') }}</button>
    </PageHeader>

    <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
    <p v-if="notice" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{{ notice }}</p>

    <form class="card flex flex-wrap items-end gap-2" @submit.prevent="lookup">
      <label class="min-w-64 flex-1 text-sm">
        <span class="mb-1 block text-slate-600">{{ t('cards.lookup') }}</span>
        <input v-model="lookupNumber" class="input text-lg" :placeholder="t('cards.readCard')" autocomplete="off" data-testid="card-lookup" />
      </label>
      <button class="btn" type="submit">{{ t('cards.lookupButton') }}</button>
    </form>

    <form v-if="mode === 'register'" class="card grid gap-3 sm:grid-cols-2" data-testid="card-register" @submit.prevent="saveRegister">
      <h2 class="font-semibold sm:col-span-2">{{ t('cards.register') }}</h2>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('cards.number') }}</span>
        <input v-model="register.number" class="input" required autocomplete="off" :placeholder="t('cards.readCard')" />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('cards.holderOptional') }}</span>
        <input v-model="register.holder" class="input" maxlength="120" />
      </label>
      <label v-if="guests.length" class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('cards.guestOptional') }}</span>
        <select v-model.number="register.guestId" class="input">
          <option :value="0">-</option>
          <option v-for="guest in guests" :key="guest.id" :value="guest.id">{{ guest.firstName }} {{ guest.lastName }}</option>
        </select>
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('cards.initialAmount') }}</span>
        <input v-model.number="register.amount" class="input" type="number" min="0" step="0.01" inputmode="decimal" />
      </label>
      <div v-if="register.amount > 0" class="space-y-2 sm:col-span-2">
        <PaymentTypeSelect v-model:type-id="register.paymentTypeId" v-model:cash-session-id="register.cashSessionId" v-model:reference="register.reference" :registers="registers" no-event-card />
      </div>
      <div class="flex justify-end gap-2 sm:col-span-2">
        <button class="btn-secondary" type="button" @click="mode = ''">{{ t('common.cancel') }}</button>
        <button class="btn" type="submit" :disabled="busy">{{ t('cards.save') }}</button>
      </div>
    </form>

    <form v-if="mode === 'discharge'" class="card space-y-3" data-testid="card-discharge" @submit.prevent="saveDischarge">
      <h2 class="font-semibold">{{ t('cards.discharge') }}</h2>
      <p class="text-sm text-slate-600">{{ t('cards.dischargeHint') }}</p>
      <label class="flex items-center gap-2 text-sm"><input v-model="discharge.includeGuests" type="checkbox" @change="loadDischarge" />{{ t('cards.includeGuests') }}</label>
      <p v-if="discharge.left" class="text-xs text-slate-500">{{ t('cards.guestsLeft', { n: discharge.left }) }}</p>
      <p class="text-sm font-semibold">{{ t('cards.dischargeTotal', { n: discharge.cards.length, total: money(discharge.total) }) }}</p>
      <div class="flex gap-4 text-sm">
        <label class="flex items-center gap-2"><input v-model="discharge.refund" type="radio" :value="true" />{{ t('cards.withRefund') }}</label>
        <label class="flex items-center gap-2"><input v-model="discharge.refund" type="radio" :value="false" />{{ t('cards.withoutRefund') }}</label>
      </div>
      <div v-if="discharge.refund" class="grid gap-2 sm:grid-cols-2">
        <PaymentTypeSelect v-model:type-id="discharge.paymentTypeId" v-model:cash-session-id="discharge.cashSessionId" v-model:reference="discharge.reference" :registers="registers" no-event-card />
      </div>
      <input v-model="discharge.reason" class="input" :placeholder="t('cards.reason')" minlength="3" maxlength="200" required />
      <div class="flex justify-end gap-2">
        <button class="btn-secondary" type="button" @click="mode = ''">{{ t('common.cancel') }}</button>
        <button class="btn" type="submit" :disabled="busy || !discharge.cards.length">{{ t('cards.dischargeConfirm') }}</button>
      </div>
    </form>

    <section v-if="current" class="card space-y-3" :data-testid="`card-${current.number}`">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">{{ t('cards.card', { number: current.number }) }}</h2>
          <p class="text-sm text-slate-600">{{ holderOf(current) }} · <span :class="current.active ? 'text-emerald-700' : 'text-rose-700'">{{ current.active ? t('common.active') : t('cards.blockedState') }}</span></p>
        </div>
        <p class="text-3xl font-bold tabular-nums" data-testid="card-balance">{{ money(current.balance) }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn" type="button" :disabled="!current.active" @click="startTopup">{{ t('cards.topup') }}</button>
        <button v-if="!auth.isCashier" class="btn-secondary" type="button" @click="transfer.toNumber = ''; transfer.reason = ''; mode = 'transfer'">{{ t('cards.transfer') }}</button>
        <button class="btn-secondary" type="button" @click="printLabels([current.id])">{{ t('cards.label') }}</button>
        <button v-if="isManager" class="btn-secondary" type="button" @click="toggleActive">{{ current.active ? t('cards.block') : t('cards.unblock') }}</button>
        <button v-if="isManager" class="btn-secondary" type="button" @click="refund">{{ t('cards.refund') }}</button>
        <select v-if="guests.length" class="input w-auto" :value="current.guestId ?? 0" :aria-label="t('cards.guestOptional')" @change="setGuest(Number(($event.target as HTMLSelectElement).value))">
          <option :value="0">{{ t('cards.noGuest') }}</option>
          <option v-for="guest in guests" :key="guest.id" :value="guest.id">{{ guest.firstName }} {{ guest.lastName }}</option>
        </select>
        <button class="ml-auto text-sm text-slate-500 hover:underline" type="button" @click="current = null; mode = ''">{{ t('common.close') }}</button>
      </div>

      <form v-if="mode === 'topup'" class="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2" data-testid="card-topup" @submit.prevent="saveTopup">
        <label class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('cards.amount') }}</span>
          <input v-model.number="topup.amount" class="input text-lg" type="number" min="0.01" step="0.01" inputmode="decimal" required />
        </label>
        <div class="space-y-2">
          <PaymentTypeSelect v-model:type-id="topup.paymentTypeId" v-model:cash-session-id="topup.cashSessionId" v-model:reference="topup.reference" :registers="registers" no-event-card />
        </div>
        <div class="flex justify-end gap-2 sm:col-span-2">
          <button class="btn-secondary" type="button" @click="mode = ''">{{ t('common.cancel') }}</button>
          <button class="btn" type="submit" :disabled="busy || !topup.amount">{{ t('cards.topupConfirm', { amount: money(topup.amount || 0) }) }}</button>
        </div>
      </form>

      <form v-if="mode === 'transfer'" class="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2" @submit.prevent="saveTransfer">
        <input v-model="transfer.toNumber" class="input" :placeholder="t('cards.toCard')" required autocomplete="off" />
        <input v-model="transfer.reason" class="input" :placeholder="t('cards.reason')" minlength="3" required />
        <label class="flex items-center gap-2 text-sm"><input v-model="transfer.block" type="checkbox" />{{ t('cards.blockSource') }}</label>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" type="button" @click="mode = ''">{{ t('common.cancel') }}</button>
          <button class="btn" type="submit" :disabled="busy">{{ t('cards.transferConfirm') }}</button>
        </div>
      </form>

      <div class="flex flex-wrap items-end gap-2 text-sm">
        <label>{{ t('cards.from') }} <input v-model="range.from" class="input" type="date" @change="open(current.id)" /></label>
        <label>{{ t('cards.to') }} <input v-model="range.to" class="input" type="date" @change="open(current.id)" /></label>
        <span v-if="movements" class="ml-auto text-slate-600">{{ t('cards.totals', { credit: money(movements.credit), debit: money(movements.debit) }) }}</span>
      </div>
      <div class="max-h-96 overflow-auto">
        <table class="w-full text-left text-sm">
          <thead class="sticky top-0 bg-white text-slate-600">
            <tr>
              <th class="py-1 pr-2">{{ t('common.date') }}</th>
              <th class="py-1 pr-2">{{ t('cards.operation') }}</th>
              <th class="py-1 pr-2 text-right">{{ t('cards.amount') }}</th>
              <th class="py-1 pr-2 text-right">{{ t('cards.balance') }}</th>
              <th class="py-1 pr-2">{{ t('cards.detail') }}</th>
              <th class="py-1"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in movements?.items ?? []" :key="item.id" class="border-t border-slate-100">
              <td class="py-1 pr-2 whitespace-nowrap">{{ formatDateTime(item.createdAt) }}</td>
              <td class="py-1 pr-2">{{ movementLabel(item.type) }}</td>
              <td class="py-1 pr-2 text-right tabular-nums" :class="Number(item.amount) < 0 ? 'text-rose-600' : 'text-emerald-700'">{{ money(item.amount) }}</td>
              <td class="py-1 pr-2 text-right tabular-nums">{{ money(item.balanceAfter) }}</td>
              <td class="py-1 pr-2 text-slate-500">{{ [item.loadPayment?.paymentType?.name, item.reason, item.createdBy?.name].filter(Boolean).join(' · ') }}</td>
              <td class="py-1 text-right">
                <button v-if="item.type === 'LOAD' || item.type === 'TOPUP'" class="text-xs text-indigo-600 hover:underline" type="button" @click="receipt(item.id)">{{ t('cards.receipt') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <form class="flex gap-2" @submit.prevent="load">
        <input v-model="search" class="input w-64" type="search" :placeholder="t('cards.search')" />
        <button class="btn-secondary" type="submit">{{ t('cards.searchButton') }}</button>
      </form>
      <div class="flex items-center gap-3">
        <button v-if="selected.length" class="btn-secondary" type="button" @click="printLabels(selected)">{{ t('cards.labels', { n: selected.length }) }}</button>
        <ExportList :title="t('nav.cards')" :columns="exportColumns()" :rows="exportRows" />
      </div>
    </div>
    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="w-8 px-4 py-3"></th>
            <th class="px-4 py-3">{{ t('cards.number') }}</th>
            <th class="px-4 py-3">{{ t('cards.holder') }}</th>
            <th class="px-4 py-3 text-right">{{ t('cards.balance') }}</th>
            <th class="px-4 py-3">{{ t('common.status') }}</th>
            <th class="px-4 py-3">{{ t('cards.lastMovement') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="card in cards" :key="card.id" class="cursor-pointer border-b border-slate-100 hover:bg-slate-50" @click="mode = ''; open(card.id)">
            <td class="px-4 py-3" @click.stop><input v-model="selected" type="checkbox" :value="card.id" :aria-label="t('cards.card', { number: card.number })" /></td>
            <td class="px-4 py-3 font-medium">{{ card.number }}</td>
            <td class="px-4 py-3">{{ holderOf(card) }}</td>
            <td class="px-4 py-3 text-right tabular-nums">{{ money(card.balance) }}</td>
            <td class="px-4 py-3"><span :class="card.active ? 'text-emerald-700' : 'text-rose-700'">{{ card.active ? t('common.active') : t('cards.blockedState') }}</span></td>
            <td class="px-4 py-3 text-slate-500">{{ card.lastMovementAt ? formatDateTime(card.lastMovementAt) : '-' }}</td>
          </tr>
          <tr v-if="!cards.length">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">{{ t('cards.empty') }}</td>
          </tr>
        </tbody>
        <tfoot v-if="cards.length" class="border-t border-slate-200 font-semibold">
          <tr>
            <td colspan="3" class="px-4 py-3">{{ t('cards.circulation') }}</td>
            <td class="px-4 py-3 text-right tabular-nums">{{ money(totalBalance) }}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>

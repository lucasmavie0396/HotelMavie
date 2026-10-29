<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, CashSession, CashSessionDetail } from '@/types';
import { formatDateTime, formatMoney, PAYMENT_METHOD_LABELS } from '@/utils/format';

const auth = useAuthStore();
const hotels = useHotelsStore();
const registers = ref<CashRegister[]>([]);
const detail = ref<CashSessionDetail | null>(null);
const history = ref<CashSession[]>([]);
const error = ref('');
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
    if (!window.confirm('Fechar a caixa? Depois de fechada nao aceita mais movimentos.')) {
      return;
    }
    await api.post(`/cash-sessions/${detail.value!.id}/close`, closing);
    await showSession(detail.value!.id);
  });

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="cash" subtitle="Abertura, movimentos e fecho de caixa" />

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="register in registers" :key="register.id" class="card space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">{{ register.name }}</h2>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-medium"
            :class="register.sessions.length ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'"
          >
            {{ register.sessions.length ? 'Aberta' : 'Fechada' }}
          </span>
        </div>
        <template v-if="register.sessions[0]">
          <p class="text-sm text-slate-600">
            Aberta por {{ register.sessions[0].openedBy?.name }} em {{ formatDateTime(register.sessions[0].openedAt) }}
          </p>
          <button class="btn w-full" type="button" @click="showSession(register.sessions[0].id)">Ver / fechar caixa</button>
        </template>
        <form v-else class="flex gap-2" @submit.prevent="openRegister(register.id)">
          <input v-model.number="opening[register.id]" class="input" type="number" min="0" step="0.01" placeholder="Fundo de caixa" />
          <button class="btn whitespace-nowrap" type="submit" :disabled="busy">Abrir</button>
        </form>
        <button class="text-xs text-indigo-600 hover:underline" type="button" @click="showHistory(register.id)">Historico</button>
      </div>

      <form v-if="isManager" class="card flex items-end gap-2" @submit.prevent="createRegister">
        <label class="flex-1 text-sm">
          Nova caixa
          <input v-model="newRegister" class="input" placeholder="Ex.: Rececao, Bar" required />
        </label>
        <button class="btn" type="submit" :disabled="busy">Criar</button>
      </form>
    </div>

    <div v-if="detail" class="card space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">
          {{ detail.register.name }} · sessao de {{ formatDateTime(detail.openedAt) }}
          <span v-if="detail.closedAt" class="text-sm font-normal text-slate-500">(fechada {{ formatDateTime(detail.closedAt) }})</span>
        </h2>
        <button class="text-sm text-slate-500 hover:underline" type="button" @click="detail = null">Fechar painel</button>
      </div>

      <div class="grid gap-4 sm:grid-cols-4">
        <div><p class="text-xs text-slate-500">Fundo inicial</p><p class="font-semibold">{{ money(detail.openingAmount) }}</p></div>
        <div><p class="text-xs text-slate-500">Recebido em numerario</p><p class="font-semibold">{{ money(detail.payments.reduce((s, p) => s + Number(p.amount), 0)) }}</p></div>
        <div><p class="text-xs text-slate-500">Esperado em caixa</p><p class="text-lg font-semibold">{{ money(detail.expected) }}</p></div>
        <div v-if="detail.closedAt">
          <p class="text-xs text-slate-500">Contado · diferenca</p>
          <p class="font-semibold" :class="Number(detail.difference) === 0 ? 'text-emerald-700' : 'text-rose-600'">
            {{ money(detail.countedAmount ?? 0) }} · {{ money(detail.difference ?? 0) }}
          </p>
        </div>
      </div>

      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr><th class="py-2">Hora</th><th class="py-2">Movimento</th><th class="py-2 text-right">Valor</th></tr>
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
            <td class="py-2">{{ item.type === 'IN' ? 'Entrada' : 'Saida' }} · {{ item.description }}</td>
            <td class="py-2 text-right" :class="item.type === 'OUT' ? 'text-rose-600' : ''">
              {{ item.type === 'OUT' ? '-' : '' }}{{ money(item.amount) }}
            </td>
          </tr>
        </tbody>
      </table>

      <template v-if="!detail.closedAt">
        <form class="grid gap-3 sm:grid-cols-4" @submit.prevent="addMovement">
          <select v-model="movement.type" class="input">
            <option value="OUT">Saida de caixa</option>
            <option value="IN">Entrada de caixa</option>
          </select>
          <input v-model.number="movement.amount" class="input" type="number" min="0.01" step="0.01" placeholder="Valor" required />
          <input v-model="movement.description" class="input" placeholder="Descricao" required />
          <button class="btn-secondary" type="submit" :disabled="busy">Registar movimento</button>
        </form>
        <form class="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-4" @submit.prevent="closeSession">
          <label class="text-sm">
            Valor contado
            <input v-model.number="closing.countedAmount" class="input" type="number" min="0" step="0.01" required />
          </label>
          <input v-model="closing.notes" class="input self-end sm:col-span-2" placeholder="Notas do fecho" />
          <button class="btn self-end" type="submit" :disabled="busy">Fechar caixa</button>
        </form>
      </template>
    </div>

    <div v-if="history.length" class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">Abertura</th>
            <th class="px-4 py-3">Fecho</th>
            <th class="px-4 py-3 text-right">Esperado</th>
            <th class="px-4 py-3 text-right">Contado</th>
            <th class="px-4 py-3 text-right">Diferenca</th>
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
            <td class="px-4 py-3">{{ session.closedAt ? `${formatDateTime(session.closedAt)} · ${session.closedBy?.name}` : 'Aberta' }}</td>
            <td class="px-4 py-3 text-right">{{ session.expectedAmount ? money(session.expectedAmount) : '-' }}</td>
            <td class="px-4 py-3 text-right">{{ session.countedAmount ? money(session.countedAmount) : '-' }}</td>
            <td class="px-4 py-3 text-right">{{ session.difference ? money(session.difference) : '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

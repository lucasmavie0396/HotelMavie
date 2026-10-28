<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { StockLevelRow, StockMovement, Warehouse } from '@/types';
import { formatDateTime, formatMoney } from '@/utils/format';

const MOVEMENT_LABELS: Record<StockMovement['type'], string> = {
  PURCHASE: 'Compra',
  SALE: 'Venda',
  ADJUSTMENT: 'Ajuste',
  TRANSFER_IN: 'Transf. entrada',
  TRANSFER_OUT: 'Transf. saida',
  WASTE: 'Quebra',
};

const auth = useAuthStore();
const hotels = useHotelsStore();
const warehouses = ref<Warehouse[]>([]);
const warehouseId = ref(0);
const levels = ref<StockLevelRow[]>([]);
const movements = ref<StockMovement[]>([]);
const error = ref('');
const busy = ref(false);
const onlyLow = ref(false);
const newWarehouse = ref('');

const action = reactive({ kind: '' as '' | 'adjust' | 'waste' | 'transfer', productId: 0, quantity: 0, reason: '', toWarehouseId: 0 });

const isManager = computed(() => auth.user?.role !== 'RECEPTION');
const shown = computed(() => (onlyLow.value ? levels.value.filter((l) => l.belowMinimum) : levels.value));
const stockValue = computed(() => levels.value.reduce((sum, l) => sum + Math.max(Number(l.quantity), 0) * Number(l.cost), 0));

async function loadWarehouses() {
  warehouses.value = (await api.get<Warehouse[]>('/warehouses', { params: { hotelId: hotels.selectedId } })).data;
  if (!warehouses.value.some((w) => w.id === warehouseId.value)) {
    warehouseId.value = warehouses.value[0]?.id ?? 0;
  }
}

async function load() {
  error.value = '';
  try {
    await loadWarehouses();
    if (!warehouseId.value) return;
    const [l, m] = await Promise.all([
      api.get<StockLevelRow[]>(`/warehouses/${warehouseId.value}/stock`),
      api.get<StockMovement[]>('/stock-movements', { params: { hotelId: hotels.selectedId, warehouseId: warehouseId.value } }),
    ]);
    levels.value = l.data;
    movements.value = m.data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
    action.kind = '';
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function start(kind: 'adjust' | 'waste' | 'transfer', row: StockLevelRow) {
  Object.assign(action, {
    kind,
    productId: row.id,
    quantity: kind === 'adjust' ? Number(row.quantity) : 1,
    reason: '',
    toWarehouseId: warehouses.value.find((w) => w.id !== warehouseId.value)?.id ?? 0,
  });
}

const submit = () =>
  run(() => {
    const base = `/warehouses/${warehouseId.value}`;
    if (action.kind === 'adjust') {
      return api.post(`${base}/adjust`, { productId: action.productId, countedQuantity: action.quantity, reason: action.reason || undefined });
    }
    if (action.kind === 'waste') {
      return api.post(`${base}/waste`, { productId: action.productId, quantity: action.quantity, reason: action.reason });
    }
    return api.post(`${base}/transfer`, { productId: action.productId, quantity: action.quantity, toWarehouseId: action.toWarehouseId });
  });

const createWarehouse = () =>
  run(async () => {
    await api.post('/warehouses', { hotelId: hotels.selectedId, name: newWarehouse.value });
    newWarehouse.value = '';
  });

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">Stocks</h1>
      <div class="flex flex-wrap items-center gap-2">
        <select v-model.number="warehouseId" class="input w-auto" @change="load">
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}{{ w.isDefault ? ' (principal)' : '' }}</option>
        </select>
        <form v-if="isManager" class="flex gap-2" @submit.prevent="createWarehouse">
          <input v-model="newWarehouse" class="input w-40" placeholder="Novo armazem" required />
          <button class="btn-secondary" type="submit" :disabled="busy">Criar</button>
        </form>
      </div>
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="!warehouses.length" class="text-sm text-slate-500">Cria um armazem para comecar. O primeiro fica como principal e e usado nas vendas.</p>

    <template v-if="warehouseId">
      <div class="flex flex-wrap items-center gap-4 text-sm">
        <label class="flex items-center gap-2"><input v-model="onlyLow" type="checkbox" />So abaixo do minimo</label>
        <span class="text-slate-600">Valor em stock (custo medio): <strong>{{ formatMoney(stockValue, hotels.currency) }}</strong></span>
      </div>

      <form v-if="action.kind" class="card grid gap-3 sm:grid-cols-4" @submit.prevent="submit">
        <h2 class="font-semibold sm:col-span-4">
          {{ action.kind === 'adjust' ? 'Contagem' : action.kind === 'waste' ? 'Registar quebra' : 'Transferir' }} ·
          {{ levels.find((l) => l.id === action.productId)?.name }}
        </h2>
        <label class="text-sm">
          {{ action.kind === 'adjust' ? 'Quantidade contada' : 'Quantidade' }}
          <input v-model.number="action.quantity" class="input" type="number" min="0" step="0.001" required />
        </label>
        <select v-if="action.kind === 'transfer'" v-model.number="action.toWarehouseId" class="input self-end">
          <option v-for="w in warehouses.filter((x) => x.id !== warehouseId)" :key="w.id" :value="w.id">Para {{ w.name }}</option>
        </select>
        <input v-else v-model="action.reason" class="input self-end sm:col-span-2" placeholder="Motivo" :required="action.kind === 'waste'" />
        <div class="flex justify-end gap-2 self-end">
          <button class="btn-secondary" type="button" @click="action.kind = ''">Cancelar</button>
          <button class="btn" type="submit" :disabled="busy">Registar</button>
        </div>
      </form>

      <div class="card overflow-x-auto p-0">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th class="px-4 py-3">Produto</th>
              <th class="px-4 py-3 text-right">Quantidade</th>
              <th class="px-4 py-3 text-right">Minimo</th>
              <th class="px-4 py-3 text-right">Custo medio</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in shown" :key="row.id" class="border-b border-slate-100" :class="row.belowMinimum ? 'bg-rose-50' : ''">
              <td class="px-4 py-3 font-medium">{{ row.name }} <span class="text-xs text-slate-500">{{ row.category?.name }}</span></td>
              <td class="px-4 py-3 text-right" :class="row.belowMinimum ? 'font-semibold text-rose-700' : ''">
                {{ Number(row.quantity) }} {{ row.unit }}
              </td>
              <td class="px-4 py-3 text-right">{{ Number(row.minStock) }}</td>
              <td class="px-4 py-3 text-right">{{ formatMoney(row.cost, hotels.currency) }}</td>
              <td class="space-x-3 px-4 py-3 text-right text-xs">
                <button v-if="isManager" class="text-indigo-600 hover:underline" type="button" @click="start('adjust', row)">Contar</button>
                <button class="text-indigo-600 hover:underline" type="button" @click="start('waste', row)">Quebra</button>
                <button
                  v-if="isManager && warehouses.length > 1"
                  class="text-indigo-600 hover:underline"
                  type="button"
                  @click="start('transfer', row)"
                >
                  Transferir
                </button>
              </td>
            </tr>
            <tr v-if="!shown.length">
              <td colspan="5" class="px-4 py-6 text-center text-slate-500">Sem produtos com controlo de stock</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card overflow-x-auto p-0">
        <h2 class="px-4 pt-4 font-semibold">Ultimos movimentos</h2>
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 text-slate-600">
            <tr>
              <th class="px-4 py-2">Data</th>
              <th class="px-4 py-2">Produto</th>
              <th class="px-4 py-2">Tipo</th>
              <th class="px-4 py-2 text-right">Qtd</th>
              <th class="px-4 py-2 text-right">Saldo</th>
              <th class="px-4 py-2">Motivo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in movements" :key="m.id" class="border-b border-slate-100">
              <td class="px-4 py-2">{{ formatDateTime(m.createdAt) }}</td>
              <td class="px-4 py-2">{{ m.product.name }}</td>
              <td class="px-4 py-2">{{ MOVEMENT_LABELS[m.type] }}</td>
              <td class="px-4 py-2 text-right" :class="Number(m.quantity) < 0 ? 'text-rose-600' : 'text-emerald-700'">{{ Number(m.quantity) }}</td>
              <td class="px-4 py-2 text-right">{{ Number(m.balance) }}</td>
              <td class="px-4 py-2 text-slate-500">{{ m.reason }} {{ m.createdBy ? `· ${m.createdBy.name}` : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

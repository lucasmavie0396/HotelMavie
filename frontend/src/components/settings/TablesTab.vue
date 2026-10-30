<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { DiningTable, Outlet } from '@/types';

const OUTLETS: { value: Outlet; label: string }[] = [
  { value: 'RESTAURANT', label: 'Restaurante' },
  { value: 'BAR', label: 'Bar' },
];

const hotels = useHotelsStore();
const outlet = ref<Outlet>('RESTAURANT');
const tables = ref<DiningTable[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const add = reactive({ count: 10, seats: 4 });
const editing = ref<number | null>(null);
const edit = reactive({ number: 1, name: '', seats: 4 });

const visible = computed(() => tables.value.filter((table) => table.outlet === outlet.value));
const nextNumber = computed(() => visible.value.reduce((max, table) => Math.max(max, table.number), 0) + 1);

async function load() {
  tables.value = (await api.get<DiningTable[]>('/dining-tables', { params: { hotelId: hotels.selectedId } })).data;
}

async function run(action: () => Promise<unknown>, message: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    notice.value = message;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const create = () =>
  run(
    () => api.post('/dining-tables', { hotelId: hotels.selectedId, outlet: outlet.value, count: add.count, seats: add.seats }),
    `${add.count} mesa(s) criada(s) a partir da n.o ${nextNumber.value}`,
  );

function startEdit(table: DiningTable) {
  editing.value = table.id;
  Object.assign(edit, { number: table.number, name: table.name ?? '', seats: table.seats });
}

const save = (table: DiningTable) =>
  run(async () => {
    await api.patch(`/dining-tables/${table.id}`, { number: edit.number, name: edit.name || null, seats: edit.seats });
    editing.value = null;
  }, 'Mesa guardada');

const toggle = (table: DiningTable) =>
  run(() => api.patch(`/dining-tables/${table.id}`, { active: !table.active }), table.active ? 'Mesa desativada' : 'Mesa ativada');

const remove = (table: DiningTable) => {
  if (!window.confirm(`Apagar a ${table.label}? As contas antigas mantem o nome da mesa.`)) return;
  return run(() => api.delete(`/dining-tables/${table.id}`), 'Mesa apagada');
};

onMounted(() => run(load, ''));
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
      As mesas ficam guardadas e aparecem no Ponto de venda. Basta tocar numa mesa livre para abrir a conta; cada mesa so tem uma conta aberta de
      cada vez. A numeracao e automatica e continua a partir da ultima mesa.
    </div>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-100">
        <button
          v-for="item in OUTLETS"
          :key="item.value"
          type="button"
          class="rounded-lg px-4 py-1.5 text-sm"
          :class="outlet === item.value ? 'bg-gradient-to-r from-indigo-600 to-violet-600 font-medium text-white shadow' : 'text-slate-600 hover:bg-slate-50'"
          @click="outlet = item.value; editing = null"
        >
          {{ item.label }} ({{ tables.filter((table) => table.outlet === item.value).length }})
        </button>
      </div>
      <form class="card flex flex-wrap items-end gap-2 p-3" @submit.prevent="create">
        <label class="text-sm">Quantas mesas<input v-model.number="add.count" class="input mt-1 w-24" type="number" min="1" max="100" required /></label>
        <label class="text-sm">Lugares<input v-model.number="add.seats" class="input mt-1 w-20" type="number" min="1" max="50" required /></label>
        <button class="btn" type="submit" :disabled="busy">+ Criar mesas {{ nextNumber }} a {{ nextNumber + Math.max(add.count, 1) - 1 }}</button>
      </form>
    </div>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
      <div
        v-for="table in visible"
        :key="table.id"
        class="rounded-2xl border p-3 shadow-sm transition"
        :class="table.active ? 'border-slate-100 bg-white' : 'border-dashed border-slate-300 bg-slate-50 text-slate-400'"
      >
        <form v-if="editing === table.id" class="space-y-2" @submit.prevent="save(table)">
          <label class="block text-xs">N.o<input v-model.number="edit.number" class="input mt-0.5" type="number" min="1" max="9999" required /></label>
          <label class="block text-xs">Nome (opcional)<input v-model="edit.name" class="input mt-0.5" maxlength="40" :placeholder="`Mesa ${edit.number}`" /></label>
          <label class="block text-xs">Lugares<input v-model.number="edit.seats" class="input mt-0.5" type="number" min="1" max="50" required /></label>
          <div class="flex gap-1">
            <button class="btn flex-1 px-2 py-1 text-xs" type="submit" :disabled="busy">Guardar</button>
            <button class="btn-secondary px-2 py-1 text-xs" type="button" @click="editing = null">X</button>
          </div>
        </form>
        <template v-else>
          <div class="flex items-start justify-between gap-2">
            <span class="flex size-11 items-center justify-center rounded-xl text-lg font-bold" :class="table.active ? 'bg-gradient-to-br from-rose-500 to-pink-500 text-white shadow' : 'bg-slate-200'">
              {{ table.number }}
            </span>
            <span v-if="table.openOrder" class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">ocupada</span>
          </div>
          <p class="mt-2 truncate text-sm font-semibold" :class="table.active ? 'text-slate-900' : ''">{{ table.label }}</p>
          <p class="text-xs text-slate-500">{{ table.seats }} lugares{{ table.active ? '' : ' · inativa' }}</p>
          <div class="mt-2 flex gap-2 text-xs">
            <button class="text-indigo-600 hover:underline" type="button" @click="startEdit(table)">Editar</button>
            <button class="text-slate-600 hover:underline" type="button" :disabled="busy" @click="toggle(table)">{{ table.active ? 'Desativar' : 'Ativar' }}</button>
            <button class="text-rose-600 hover:underline" type="button" :disabled="busy" @click="remove(table)">Apagar</button>
          </div>
        </template>
      </div>
      <p v-if="!visible.length" class="col-span-full rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-100">
        Ainda nao ha mesas neste ponto de venda. Cria-as acima.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage, openInvoicePdf } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, Order, Outlet, PaymentMethod, Product, Reservation } from '@/types';
import { formatMoney, PAYMENT_METHOD_LABELS } from '@/utils/format';

const hotels = useHotelsStore();
const outlet = ref<Outlet>('RESTAURANT');
const orders = ref<Order[]>([]);
const products = ref<Product[]>([]);
const inHouse = ref<Reservation[]>([]);
const registers = ref<CashRegister[]>([]);
const current = ref<Order | null>(null);
const error = ref('');
const busy = ref(false);
const newTable = ref('');
const categoryFilter = ref<number | 0>(0);
const closing = ref(false);

const close = reactive({
  mode: 'PAY' as 'PAY' | 'ROOM',
  reservationId: 0,
  customerTaxId: '',
  payments: [{ method: 'CARD' as PaymentMethod, amount: 0, cashSessionId: 0 }],
});

const money = (value: string | number) => formatMoney(value, hotels.currency);
const categories = computed(() => {
  const map = new Map<number, string>();
  for (const product of products.value) {
    if (product.category) map.set(product.category.id, product.category.name);
  }
  return [...map.entries()];
});
const visibleProducts = computed(() =>
  products.value.filter((p) => p.active && (!categoryFilter.value || p.categoryId === categoryFilter.value)),
);
const openSessions = computed(() =>
  registers.value.flatMap((register) => register.sessions.map((session) => ({ id: session.id, label: register.name }))),
);
const paidTotal = computed(() => close.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0));

async function load() {
  error.value = '';
  try {
    const params = { hotelId: hotels.selectedId };
    const [o, p, r, c] = await Promise.all([
      api.get<Order[]>('/orders', { params: { ...params, status: 'OPEN', outlet: outlet.value } }),
      api.get<Product[]>('/products', { params: { ...params, outlet: outlet.value, sellable: true } }),
      api.get<Reservation[]>('/reservations', { params: { ...params, status: 'CHECKED_IN' } }),
      api.get<CashRegister[]>('/cash-registers', { params }),
    ]);
    orders.value = o.data;
    products.value = p.data;
    inHouse.value = r.data;
    registers.value = c.data;
    if (current.value) {
      current.value = orders.value.find((order) => order.id === current.value!.id) ?? null;
    }
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: () => Promise<Order | void>) {
  busy.value = true;
  error.value = '';
  try {
    const result = await action();
    if (result) {
      current.value = result;
    }
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function switchOutlet(value: Outlet) {
  outlet.value = value;
  current.value = null;
  categoryFilter.value = 0;
  load();
}

const openOrder = () =>
  run(async () => {
    const { data } = await api.post<Order>('/orders', { hotelId: hotels.selectedId, outlet: outlet.value, tableLabel: newTable.value || undefined });
    newTable.value = '';
    return data;
  });

const addItem = (product: Product) =>
  run(async () => (await api.post<Order>(`/orders/${current.value!.id}/items`, { productId: product.id, quantity: 1 })).data);

const removeItem = (itemId: number) =>
  run(async () => (await api.delete<Order>(`/orders/${current.value!.id}/items/${itemId}`)).data);

const cancelOrder = () =>
  run(async () => {
    if (!window.confirm('Anular este pedido?')) return;
    await api.post(`/orders/${current.value!.id}/cancel`);
    current.value = null;
  });

function startClose() {
  Object.assign(close, {
    mode: 'PAY',
    reservationId: inHouse.value[0]?.id ?? 0,
    customerTaxId: '',
    payments: [{ method: 'CARD', amount: Number(current.value!.total), cashSessionId: openSessions.value[0]?.id ?? 0 }],
  });
  closing.value = true;
}

function addPaymentLine() {
  close.payments.push({ method: 'CASH', amount: Math.max(Number(current.value!.total) - paidTotal.value, 0), cashSessionId: openSessions.value[0]?.id ?? 0 });
}

const confirmClose = () =>
  run(async () => {
    const { data } = await api.post<Order>(`/orders/${current.value!.id}/close`, {
      mode: close.mode,
      reservationId: close.mode === 'ROOM' ? close.reservationId : undefined,
      customerTaxId: close.customerTaxId || undefined,
      payments:
        close.mode === 'PAY'
          ? close.payments.map((p) => ({ method: p.method, amount: p.amount, cashSessionId: p.method === 'CASH' ? p.cashSessionId || undefined : undefined }))
          : undefined,
    });
    closing.value = false;
    current.value = null;
    const invoice = data.charges.find((charge) => charge.invoice)?.invoice;
    if (invoice) {
      await openInvoicePdf(invoice.id);
    }
  });

onMounted(load);
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">Ponto de venda</h1>
      <div class="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
        <button
          v-for="item in [{ value: 'RESTAURANT', label: 'Restaurante' }, { value: 'BAR', label: 'Bar' }] as const"
          :key="item.value"
          type="button"
          class="rounded px-4 py-1.5"
          :class="outlet === item.value ? 'bg-indigo-600 text-white' : 'text-slate-700'"
          @click="switchOutlet(item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="grid gap-4 lg:grid-cols-[220px_1fr_340px]">
      <div class="card space-y-3 p-3">
        <form class="flex gap-2" @submit.prevent="openOrder">
          <input v-model="newTable" class="input" placeholder="Mesa / nome" />
          <button class="btn px-3" type="submit" :disabled="busy">+</button>
        </form>
        <button
          v-for="order in orders"
          :key="order.id"
          type="button"
          class="flex w-full justify-between rounded-md border px-3 py-2 text-left text-sm"
          :class="current?.id === order.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'"
          @click="current = order; closing = false"
        >
          <span class="font-medium">{{ order.tableLabel ?? `#${order.id}` }}</span>
          <span>{{ money(order.total) }}</span>
        </button>
        <p v-if="!orders.length" class="text-sm text-slate-500">Sem pedidos abertos</p>
      </div>

      <div class="card space-y-3 p-3">
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-full px-3 py-1 text-xs"
            :class="!categoryFilter ? 'bg-slate-900 text-white' : 'bg-slate-100'"
            @click="categoryFilter = 0"
          >
            Todos
          </button>
          <button
            v-for="[id, name] in categories"
            :key="id"
            type="button"
            class="rounded-full px-3 py-1 text-xs"
            :class="categoryFilter === id ? 'bg-slate-900 text-white' : 'bg-slate-100'"
            @click="categoryFilter = id"
          >
            {{ name }}
          </button>
        </div>
        <p v-if="!current" class="text-sm text-slate-500">Abre ou escolhe um pedido para adicionar produtos.</p>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          <button
            v-for="product in visibleProducts"
            :key="product.id"
            type="button"
            class="rounded-md border border-slate-200 p-3 text-left text-sm hover:border-indigo-400 disabled:opacity-40"
            :disabled="!current || busy"
            @click="addItem(product)"
          >
            <span class="block font-medium">{{ product.name }}</span>
            <span class="text-slate-500">{{ money(product.price) }}</span>
          </button>
        </div>
      </div>

      <div class="card space-y-3 p-3">
        <template v-if="current">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">{{ current.tableLabel ?? `Pedido #${current.id}` }}</h2>
            <button class="text-xs text-rose-600 hover:underline" type="button" @click="cancelOrder">Anular</button>
          </div>
          <ul class="divide-y divide-slate-100 text-sm">
            <li v-for="item in current.items" :key="item.id" class="flex items-center justify-between gap-2 py-1.5">
              <span>{{ Number(item.quantity) }}x {{ item.description }}</span>
              <span class="flex items-center gap-2">
                {{ money(item.total) }}
                <button class="text-rose-600" type="button" :disabled="busy" aria-label="Remover" @click="removeItem(item.id)">&times;</button>
              </span>
            </li>
          </ul>
          <p class="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold">
            Total <span>{{ money(current.total) }}</span>
          </p>
          <button v-if="!closing" class="btn w-full" type="button" :disabled="!current.items.length" @click="startClose">Fechar conta</button>

          <form v-else class="space-y-3 rounded-md bg-slate-50 p-3 text-sm" @submit.prevent="confirmClose">
            <div class="flex gap-4">
              <label class="flex items-center gap-1"><input v-model="close.mode" type="radio" value="PAY" />Pagar agora</label>
              <label class="flex items-center gap-1"><input v-model="close.mode" type="radio" value="ROOM" :disabled="!inHouse.length" />Lancar no quarto</label>
            </div>
            <select v-if="close.mode === 'ROOM'" v-model.number="close.reservationId" class="input">
              <option v-for="reservation in inHouse" :key="reservation.id" :value="reservation.id">
                Quarto {{ reservation.room.number }} · {{ reservation.guest.firstName }} {{ reservation.guest.lastName }}
              </option>
            </select>
            <template v-else>
              <div v-for="(payment, index) in close.payments" :key="index" class="grid grid-cols-2 gap-2">
                <select v-model="payment.method" class="input">
                  <option v-for="(label, method) in PAYMENT_METHOD_LABELS" :key="method" :value="method">{{ label }}</option>
                </select>
                <input v-model.number="payment.amount" class="input" type="number" min="0.01" step="0.01" />
                <select v-if="payment.method === 'CASH'" v-model.number="payment.cashSessionId" class="input col-span-2">
                  <option v-if="!openSessions.length" :value="0" disabled>Nenhuma caixa aberta</option>
                  <option v-for="session in openSessions" :key="session.id" :value="session.id">Caixa {{ session.label }}</option>
                </select>
              </div>
              <button class="text-xs text-indigo-600 hover:underline" type="button" @click="addPaymentLine">+ dividir pagamento</button>
              <p :class="Math.abs(paidTotal - Number(current.total)) < 0.005 ? 'text-emerald-700' : 'text-rose-600'">
                Pago {{ money(paidTotal) }} de {{ money(current.total) }}
              </p>
              <input v-model="close.customerTaxId" class="input" placeholder="NIF do cliente (opcional)" />
            </template>
            <div class="flex justify-end gap-2">
              <button class="btn-secondary" type="button" @click="closing = false">Voltar</button>
              <button class="btn" type="submit" :disabled="busy">Confirmar</button>
            </div>
          </form>
        </template>
        <p v-else class="text-sm text-slate-500">Nenhum pedido selecionado</p>
      </div>
    </div>
  </section>
</template>

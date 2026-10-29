<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import RoomAccountPanel from '@/components/RoomAccountPanel.vue';
import PaymentTypeSelect from '@/components/PaymentTypeSelect.vue';
import { api, errorMessage } from '@/services/api';
import { printDocument } from '@/services/print';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, Order, OrderItem, Outlet, Product, Reservation } from '@/types';
import { formatMoney } from '@/utils/format';

type Mode = Outlet | 'ROOMS';

const MODES: { value: Mode; label: string }[] = [
  { value: 'RESTAURANT', label: 'Restaurante' },
  { value: 'BAR', label: 'Bar' },
  { value: 'ROOMS', label: 'Contas de quarto' },
];

const auth = useAuthStore();
const hotels = useHotelsStore();
const mode = ref<Mode>('RESTAURANT');
const orders = ref<Order[]>([]);
const products = ref<Product[]>([]);
const inHouse = ref<Reservation[]>([]);
const registers = ref<CashRegister[]>([]);
const current = ref<Order | null>(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const newTable = ref('');
const categoryFilter = ref<number | 0>(0);
const closing = ref(false);

const close = reactive({
  mode: 'PAY' as 'PAY' | 'ROOM',
  reservationId: 0,
  customerTaxId: '',
  payments: [{ paymentTypeId: 0, amount: 0, cashSessionId: 0, reference: '' }],
});

const isManager = computed(() => auth.user?.role !== 'RECEPTION');
const outlet = computed<Outlet>(() => (mode.value === 'BAR' ? 'BAR' : 'RESTAURANT'));
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
const pendingCount = computed(() => current.value?.items.filter((item) => !item.sentAt && !item.voidedAt).length ?? 0);
const activeItems = computed(() => current.value?.items.filter((item) => !item.voidedAt).length ?? 0);

function station(item: OrderItem) {
  return item.product.category?.prepStation ?? (current.value?.outlet === 'BAR' ? 'BAR' : 'KITCHEN');
}

async function load() {
  if (mode.value === 'ROOMS') return;
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

async function run(action: () => Promise<Order | void>, message = '') {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await action();
    if (result) {
      current.value = result;
    }
    notice.value = message;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function switchMode(value: Mode) {
  mode.value = value;
  current.value = null;
  closing.value = false;
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

const removeItem = (item: OrderItem) =>
  run(async () => (await api.delete<Order>(`/orders/${current.value!.id}/items/${item.id}`)).data);

const addNote = (item: OrderItem) => {
  const notes = window.prompt(`Nota para ${item.description} (ex.: sem cebola):`, item.notes ?? '');
  if (notes === null) return;
  run(async () => {
    const order = current.value!;
    await api.delete(`/orders/${order.id}/items/${item.id}`);
    return (await api.post<Order>(`/orders/${order.id}/items`, { productId: item.productId, quantity: Number(item.quantity), notes: notes || undefined })).data;
  });
};

const voidItem = (item: OrderItem) => {
  const reason = window.prompt(`Motivo da anulacao de ${Number(item.quantity)} x ${item.description}:`);
  if (!reason) return;
  run(async () => {
    const { data } = await api.post<Order>(`/orders/${current.value!.id}/items/${item.id}/void`, { reason });
    notice.value = await printDocument({ document: 'VOID', orderId: data.id, itemId: item.id });
    return data;
  }, 'Linha anulada; talao de anulacao enviado');
};

const sendOrder = () =>
  run(async () => {
    const order = current.value!;
    const { data } = await api.post<{ sentAt: string; targets: { station: 'KITCHEN' | 'BAR' | 'NONE'; printerId: number | null }[] }>(`/orders/${order.id}/send`);
    for (const target of data.targets) {
      await printDocument({ document: 'ORDER', orderId: order.id, station: target.station, printerId: target.printerId, sentAt: data.sentAt });
    }
    return (await api.get<Order>(`/orders/${order.id}`)).data;
  }, 'Pedido enviado');

const print = (request: Parameters<typeof printDocument>[0]) =>
  printDocument(request)
    .then((message) => (notice.value = message))
    .catch((e) => (error.value = errorMessage(e)));

const reprint = (target: 'KITCHEN' | 'BAR') => print({ document: 'ORDER', orderId: current.value!.id, station: target });

const prebill = () => print({ document: 'PREBILL', orderId: current.value!.id });

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
    payments: [{ paymentTypeId: 0, amount: Number(current.value!.total), cashSessionId: 0, reference: '' }],
  });
  closing.value = true;
}

function addPaymentLine() {
  close.payments.push({ paymentTypeId: 0, amount: Math.max(Number(current.value!.total) - paidTotal.value, 0), cashSessionId: 0, reference: '' });
}

const confirmClose = () =>
  run(async () => {
    const { data } = await api.post<Order>(`/orders/${current.value!.id}/close`, {
      mode: close.mode,
      reservationId: close.mode === 'ROOM' ? close.reservationId : undefined,
      customerTaxId: close.customerTaxId || undefined,
      payments:
        close.mode === 'PAY'
          ? close.payments.map((p) => ({ paymentTypeId: p.paymentTypeId, amount: p.amount, cashSessionId: p.cashSessionId || undefined, reference: p.reference || undefined }))
          : undefined,
    });
    closing.value = false;
    current.value = null;
    const invoice = data.charges.find((charge) => charge.invoice)?.invoice;
    if (invoice) {
      notice.value = await printDocument({ document: 'INVOICE', invoiceId: invoice.id });
    }
  }, close.mode === 'ROOM' ? 'Consumo lancado na conta do quarto' : 'Conta fechada');

onMounted(load);
</script>

<template>
  <section class="space-y-4">
    <PageHeader section="pos" title="Ponto de venda" subtitle="Restaurante, bar e contas dos quartos">
      <div class="flex rounded-lg bg-white p-0.5 text-sm shadow">
        <button
          v-for="item in MODES"
          :key="item.value"
          type="button"
          class="rounded px-4 py-1.5"
          :class="mode === item.value ? 'bg-indigo-600 text-white' : 'text-slate-700'"
          @click="switchMode(item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </PageHeader>

    <RoomAccountPanel v-if="mode === 'ROOMS'" />

    <template v-else>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

      <div class="grid gap-4 lg:grid-cols-[220px_1fr_360px]">
        <div class="card space-y-3 p-3 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
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
            <span class="font-medium">
              {{ order.tableLabel ?? `#${order.id}` }}
              <span v-if="order.items.some((i) => !i.sentAt && !i.voidedAt)" class="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">por enviar</span>
            </span>
            <span>{{ money(order.total) }}</span>
          </button>
          <p v-if="!orders.length" class="text-sm text-slate-500">Sem pedidos abertos</p>
        </div>

        <div class="card space-y-3 p-3 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
          <div class="flex flex-wrap gap-2">
            <button type="button" class="rounded-full px-3 py-1 text-xs" :class="!categoryFilter ? 'bg-slate-900 text-white' : 'bg-slate-100'" @click="categoryFilter = 0">
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

        <div class="card space-y-3 p-3 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
          <template v-if="current">
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">{{ current.tableLabel ?? `Pedido #${current.id}` }}</h2>
              <button class="text-xs text-rose-600 hover:underline" type="button" @click="cancelOrder">Anular pedido</button>
            </div>
            <ul class="divide-y divide-slate-100 text-sm">
              <li v-for="item in current.items" :key="item.id" class="py-1.5" :class="item.voidedAt ? 'text-slate-400' : ''">
                <div class="flex items-center justify-between gap-2">
                  <span :class="item.voidedAt ? 'line-through' : ''">
                    {{ Number(item.quantity) }}x {{ item.description }}
                    <span v-if="!item.voidedAt" class="ml-1 rounded px-1 text-[10px]" :class="item.sentAt ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                      {{ item.sentAt ? (station(item) === 'BAR' ? 'bar' : station(item) === 'NONE' ? 'servido' : 'cozinha') : 'por enviar' }}
                    </span>
                  </span>
                  <span class="flex items-center gap-2 whitespace-nowrap">
                    {{ item.voidedAt ? 'anulado' : money(item.total) }}
                    <template v-if="!item.voidedAt">
                      <button v-if="!item.sentAt" class="text-xs text-indigo-600" type="button" :disabled="busy" @click="addNote(item)">nota</button>
                      <button v-if="!item.sentAt" class="text-rose-600" type="button" :disabled="busy" aria-label="Remover" @click="removeItem(item)">&times;</button>
                      <button v-else-if="isManager" class="text-xs text-rose-600 hover:underline" type="button" :disabled="busy" @click="voidItem(item)">anular</button>
                    </template>
                  </span>
                </div>
                <p v-if="item.notes" class="text-xs text-slate-500">&gt; {{ item.notes }}</p>
                <p v-if="item.voidedAt" class="text-xs">Anulado: {{ item.voidReason }} ({{ item.voidedBy?.name }})</p>
              </li>
            </ul>
            <p class="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold">
              Total <span>{{ money(current.total) }}</span>
            </p>

            <div v-if="!closing" class="grid grid-cols-2 gap-2">
              <button class="btn col-span-2" type="button" :disabled="busy || !pendingCount" @click="sendOrder">
                Enviar pedido{{ pendingCount ? ` (${pendingCount})` : '' }}
              </button>
              <button class="btn-secondary" type="button" :disabled="!activeItems" @click="prebill">Pre-conta</button>
              <button class="btn" type="button" :disabled="!activeItems" @click="startClose">Fechar conta</button>
              <div v-if="current.items.some((i) => i.sentAt)" class="col-span-2 flex gap-3 text-xs">
                Reimprimir:
                <button class="text-indigo-600 hover:underline" type="button" @click="reprint('KITCHEN')">cozinha</button>
                <button class="text-indigo-600 hover:underline" type="button" @click="reprint('BAR')">bar</button>
              </div>
            </div>

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
                <div v-for="(payment, index) in close.payments" :key="index" class="grid grid-cols-2 gap-2 rounded border border-slate-200 bg-white p-2">
                  <input v-model.number="payment.amount" class="input col-span-2" type="number" min="0.01" step="0.01" aria-label="Valor" />
                  <PaymentTypeSelect
                    v-model:type-id="payment.paymentTypeId"
                    v-model:cash-session-id="payment.cashSessionId"
                    v-model:reference="payment.reference"
                    :registers="registers"
                  />
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
    </template>
  </section>
</template>

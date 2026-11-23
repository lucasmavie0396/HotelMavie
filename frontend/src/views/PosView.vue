<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import RoomAccountPanel from '@/components/RoomAccountPanel.vue';
import CashRequired from '@/components/CashRequired.vue';
import PaperLinks from '@/components/PaperLinks.vue';
import PaymentTypeSelect from '@/components/PaymentTypeSelect.vue';
import { useOwnCash } from '@/composables/cashGuard';
import { api, errorMessage } from '@/services/api';
import { askConfirm, askText } from '@/services/dialog';
import { fileUrl } from '@/services/files';
import { printDocument } from '@/services/print';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, DiningTable, Order, OrderItem, Outlet, Product, Reservation } from '@/types';
import { formatMoney } from '@/utils/format';

type Mode = Outlet | 'ROOMS';

const MODES: { value: Mode; label: string }[] = [
  { value: 'RESTAURANT', label: 'labels.outlet.RESTAURANT' },
  { value: 'BAR', label: 'labels.outlet.BAR' },
  { value: 'ROOMS', label: 'pos.roomAccounts' },
];

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const mode = ref<Mode>('RESTAURANT');
const orders = ref<Order[]>([]);
const products = ref<Product[]>([]);
const inHouse = ref<Reservation[]>([]);
const registers = ref<CashRegister[]>([]);
const current = ref<Order | null>(null);
const view = ref<'tables' | 'products'>('tables');
const error = ref('');
const notice = ref('');
const busy = ref(false);
const newTable = ref('');
const tables = ref<DiningTable[]>([]);
const activeTables = computed(() => tables.value.filter((table) => table.active || table.openOrder));
const looseOrders = computed(() => orders.value.filter((order) => !order.tableId));
const categoryFilter = ref<number | 0>(0);
const closing = ref(false);
const people = ref(2);
const moving = reactive({ active: false, target: 'split', quantities: {} as Record<number, number> });
const tableChecks = computed(() => (current.value?.tableId ? orders.value.filter((order) => order.tableId === current.value!.tableId) : []));
const moveTargets = computed(() => [
  ...activeTables.value.filter((table) => table.id !== current.value?.tableId && table.active).map((table) => ({ value: `table:${table.id}`, label: `${table.label}${table.openOrder ? ` (${t('pos.busy')})` : ''}` })),
  ...orders.value.filter((order) => order.id !== current.value?.id && !order.tableId).map((order) => ({ value: `order:${order.id}`, label: order.tableLabel ?? t('pos.order', { id: order.id }) })),
]);
const movingCount = computed(() => Object.values(moving.quantities).filter((quantity) => quantity > 0).length);

const close = reactive({
  mode: 'PAY' as 'PAY' | 'ROOM',
  reservationId: 0,
  customerTaxId: '',
  payments: [{ paymentTypeId: 0, amount: 0, cashSessionId: 0, reference: '' }],
});

const isManager = computed(() => auth.isManager);
const outlet = computed<Outlet>(() => (mode.value === 'BAR' ? 'BAR' : 'RESTAURANT'));
const money = (value: string | number) => formatMoney(value, hotels.currency);
const categories = computed(() => {
  const map = new Map<number, string>();
  for (const product of products.value) {
    if (product.category) map.set(product.category.id, product.category.name);
  }
  return [...map.entries()];
});
const CATEGORY_COLORS = ['border-l-indigo-500', 'border-l-rose-500', 'border-l-amber-500', 'border-l-emerald-500', 'border-l-sky-500', 'border-l-fuchsia-500', 'border-l-orange-500', 'border-l-teal-500'];
const categoryColor = (id: number | null) => (id ? CATEGORY_COLORS[id % CATEGORY_COLORS.length] : 'border-l-slate-300');
const visibleProducts = computed(() =>
  products.value.filter((p) => p.active && (!categoryFilter.value || p.categoryId === categoryFilter.value)),
);
const hasCash = useOwnCash(registers);
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
    const [o, p, r, c, t] = await Promise.all([
      api.get<Order[]>('/orders', { params: { ...params, status: 'OPEN', outlet: outlet.value } }),
      api.get<Product[]>('/products', { params: { ...params, outlet: outlet.value, sellable: true } }),
      api.get<Reservation[]>('/reservations', { params: { ...params, status: 'CHECKED_IN' } }),
      api.get<CashRegister[]>('/cash-registers', { params }),
      api.get<DiningTable[]>('/dining-tables', { params: { ...params, outlet: outlet.value } }),
    ]);
    orders.value = o.data;
    tables.value = t.data;
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
  view.value = 'tables';
  closing.value = false;
  categoryFilter.value = 0;
  load();
}

const openOrder = () =>
  run(async () => {
    const { data } = await api.post<Order>('/orders', { hotelId: hotels.selectedId, outlet: outlet.value, tableLabel: newTable.value || undefined });
    newTable.value = '';
    view.value = 'products';
    return data;
  });

function pickOrder(order: Order) {
  current.value = order;
  closing.value = false;
  view.value = 'products';
}

function openTable(table: DiningTable) {
  closing.value = false;
  moving.active = false;
  view.value = 'products';
  const existing = table.openOrder && orders.value.find((order) => order.id === table.openOrder!.id);
  if (existing) {
    current.value = existing;
    return;
  }
  return run(async () => (await api.post<Order>('/orders', { hotelId: hotels.selectedId, outlet: outlet.value, tableId: table.id })).data);
}

const addItem = (product: Product) =>
  run(async () => {
    const order = current.value!;
    const line = order.items.find((item) => item.productId === product.id && !item.sentAt && !item.voidedAt && !item.notes);
    if (line) return (await api.patch<Order>(`/orders/${order.id}/items/${line.id}`, { quantity: Number(line.quantity) + 1 })).data;
    return (await api.post<Order>(`/orders/${order.id}/items`, { productId: product.id, quantity: 1 })).data;
  });

const changeQuantity = (item: OrderItem, delta: number) => {
  const next = Number(item.quantity) + delta;
  if (next <= 0) return removeItem(item);
  return run(async () => (await api.patch<Order>(`/orders/${current.value!.id}/items/${item.id}`, { quantity: next })).data);
};

const removeItem = (item: OrderItem) =>
  run(async () => (await api.delete<Order>(`/orders/${current.value!.id}/items/${item.id}`)).data);

const addNote = async (item: OrderItem) => {
  const notes = await askText({ title: t('pos.noteTitle'), message: t('pos.notePrompt', { name: item.description }), value: item.notes ?? '', multiline: true });
  if (notes === null) return;
  run(async () => {
    const order = current.value!;
    await api.delete(`/orders/${order.id}/items/${item.id}`);
    return (await api.post<Order>(`/orders/${order.id}/items`, { productId: item.productId, quantity: Number(item.quantity), notes: notes || undefined })).data;
  });
};

const printingScreens = () =>
  api
    .get<{ stations: string[] }>('/kds/printing', { params: { hotelId: hotels.selectedId } })
    .then(({ data }) => data.stations)
    .catch(() => [] as string[]);

const voidItem = async (item: OrderItem) => {
  const reason = await askText({
    title: t('pos.voidTitle'),
    message: t('pos.voidPrompt', { quantity: Number(item.quantity), name: item.description }),
    required: true,
    danger: true,
    confirmLabel: t('pos.voidTitle'),
  });
  if (!reason) return;
  run(async () => {
    const { data } = await api.post<Order>(`/orders/${current.value!.id}/items/${item.id}/void`, { reason });
    if (!(await printingScreens()).includes(station(item))) {
      notice.value = await printDocument({ document: 'VOID', orderId: data.id, itemId: item.id });
    }
    return data;
  }, t('pos.voided'));
};

const sendOrder = () =>
  run(async () => {
    const order = current.value!;
    const { data } = await api.post<{ sentAt: string; targets: { station: 'KITCHEN' | 'BAR' | 'NONE'; printerId: number | null }[] }>(`/orders/${order.id}/send`);
    const screens = await printingScreens();
    for (const target of data.targets.filter((item) => !screens.includes(item.station))) {
      await printDocument({ document: 'ORDER', orderId: order.id, station: target.station, printerId: target.printerId, sentAt: data.sentAt });
    }
    return (await api.get<Order>(`/orders/${order.id}`)).data;
  }, t('pos.sent'));

const print = (request: Parameters<typeof printDocument>[0]) =>
  printDocument(request)
    .then((message) => (notice.value = message))
    .catch((e) => (error.value = errorMessage(e)));

const reprint = (target: 'KITCHEN' | 'BAR') => print({ document: 'ORDER', orderId: current.value!.id, station: target });

const prebill = () => print({ document: 'PREBILL', orderId: current.value!.id });

const cancelOrder = async () => {
  if (!(await askConfirm({ title: t('pos.cancelOrder'), message: t('pos.confirmCancel'), danger: true, confirmLabel: t('pos.cancelOrder') }))) return;
  return run(async () => {
    await api.post(`/orders/${current.value!.id}/cancel`);
    current.value = null;
  });
};

function startClose() {
  Object.assign(close, {
    mode: 'PAY',
    reservationId: inHouse.value[0]?.id ?? 0,
    customerTaxId: '',
    payments: [{ paymentTypeId: 0, amount: Number(current.value!.total), cashSessionId: 0, reference: '' }],
  });
  closing.value = true;
}

function splitByPeople() {
  const count = Math.max(2, Math.min(50, Math.floor(people.value || 2)));
  const cents = Math.round(Number(current.value!.total) * 100);
  const share = Math.floor(cents / count);
  const template = close.payments[0] ?? { paymentTypeId: 0, cashSessionId: 0, reference: '' };
  close.payments = Array.from({ length: count }, (_, index) => ({
    paymentTypeId: template.paymentTypeId,
    cashSessionId: template.cashSessionId,
    reference: '',
    amount: (index === count - 1 ? cents - share * (count - 1) : share) / 100,
  }));
}

function startMove() {
  closing.value = false;
  moving.active = true;
  moving.target = 'split';
  moving.quantities = {};
}

function toggleMoveLine(item: OrderItem) {
  moving.quantities[item.id] = moving.quantities[item.id] ? 0 : Number(item.quantity);
}

const confirmMove = () =>
  run(async () => {
    const order = current.value!;
    const items = Object.entries(moving.quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([itemId, quantity]) => ({ itemId: Number(itemId), quantity }));
    const [kind, id] = moving.target.split(':');
    const { data } = await api.post<{ from: Order; to: Order }>(`/orders/${order.id}/move-items`, {
      items,
      toTableId: kind === 'table' ? Number(id) : undefined,
      toOrderId: kind === 'order' ? Number(id) : undefined,
    });
    moving.active = false;
    return data.from.status === 'OPEN' ? data.from : data.to;
  }, t('pos.moved'));

function exactAmount(index: number) {
  const others = close.payments.reduce((sum, payment, position) => (position === index ? sum : sum + Number(payment.amount || 0)), 0);
  close.payments[index].amount = Math.max(Math.round((Number(current.value!.total) - others) * 100) / 100, 0);
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
  }, close.mode === 'ROOM' ? t('pos.chargedToRoom') : t('pos.closed'));

onMounted(load);
</script>

<template>
  <section class="flex flex-col gap-3" :class="mode === 'ROOMS' ? '' : 'h-full min-h-[34rem]'">
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-semibold text-slate-900">{{ t('pos.title') }}</h1>
      <div class="flex gap-2" role="tablist">
        <button
          v-for="item in MODES.filter((entry) => entry.value !== 'ROOMS' || !auth.isCashier)"
          :key="item.value"
          type="button"
          role="tab"
          class="chip"
          :aria-selected="mode === item.value"
          :class="mode === item.value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'"
          @click="switchMode(item.value)"
        >
          {{ t(item.label) }}
        </button>
      </div>
    </div>

    <RoomAccountPanel v-if="mode === 'ROOMS'" />

    <template v-else>
      <p v-if="error" class="shrink-0 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
      <p v-if="notice" class="shrink-0 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{{ notice }}</p>

      <div class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div class="grid shrink-0 grid-cols-2 gap-2 xl:hidden" role="tablist">
            <button type="button" role="tab" class="chip justify-center" :aria-selected="view === 'tables'" :class="view === 'tables' ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-300'" @click="view = 'tables'">
              {{ t('pos.tables') }}
            </button>
            <button type="button" role="tab" class="chip justify-center" :aria-selected="view === 'products'" :class="view === 'products' ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-300'" @click="view = 'products'">
              {{ t('pos.productsTab') }}
            </button>
          </div>

          <div class="flex min-h-0 flex-1 gap-3">
            <div class="card min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 xl:flex xl:w-60 xl:flex-none" :class="view === 'tables' ? 'flex' : 'hidden'" data-testid="pos-tables">
              <div class="flex items-center justify-between">
                <h2 class="text-sm font-semibold text-slate-700">{{ t('pos.tables') }}</h2>
                <span class="flex gap-2 text-xs text-slate-500">
                  <span class="flex items-center gap-1"><span class="size-2.5 rounded-full bg-emerald-400" />{{ t('pos.free') }}</span>
                  <span class="flex items-center gap-1"><span class="size-2.5 rounded-full bg-rose-500" />{{ t('pos.busy') }}</span>
                </span>
              </div>
              <div v-if="activeTables.length" class="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2 touch:grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]">
                <button
                  v-for="table in activeTables"
                  :key="table.id"
                  type="button"
                  class="relative flex aspect-square touch-manipulation flex-col items-center justify-center rounded-xl border-2 p-1 text-center transition select-none active:scale-[0.97] disabled:opacity-60"
                  :class="[
                    current?.tableId === table.id ? 'ring-2 ring-indigo-500 ring-offset-1' : '',
                    table.openOrder ? 'border-rose-200 bg-gradient-to-br from-rose-500 to-pink-500 text-white shadow-md' : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
                  ]"
                  :title="table.label"
                  :disabled="busy"
                  @click="openTable(table)"
                >
                  <span class="text-xl leading-none font-bold">{{ table.number }}</span>
                  <span class="w-full truncate text-xs leading-tight">{{ table.openOrder ? money(table.openOrder.total) : t('pos.seats', { n: table.seats }) }}</span>
                  <span v-if="table.openOrder?.pending" class="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-amber-950 shadow" :title="t('pos.pendingItems')">
                    {{ table.openOrder.pending }}
                  </span>
                </button>
              </div>
              <p v-else class="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
                {{ t('pos.noTables') }}
                <RouterLink v-if="isManager" :to="{ name: 'settings', query: { tab: 'tables' } }" class="text-indigo-600 hover:underline">{{ t('pos.createTables') }}</RouterLink>
                <template v-else>{{ t('pos.askManager') }}</template>
              </p>

              <div class="space-y-2 border-t border-slate-100 pt-3">
                <h2 class="text-sm font-semibold text-slate-700">{{ t('pos.noTable') }}</h2>
                <form class="flex gap-2" @submit.prevent="openOrder">
                  <input v-model="newTable" class="input" :placeholder="t('pos.optionalName')" />
                  <button class="btn px-4 text-lg" type="submit" :disabled="busy" :title="t('pos.openLoose')" :aria-label="t('pos.openLoose')">+</button>
                </form>
                <button
                  v-for="order in looseOrders"
                  :key="order.id"
                  type="button"
                  class="flex min-h-11 w-full touch-manipulation items-center justify-between rounded-lg border px-3 py-2 text-left text-sm"
                  :class="current?.id === order.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'"
                  @click="pickOrder(order)"
                >
                  <span class="font-medium">
                    {{ order.tableLabel ?? `#${order.id}` }}
                    <span v-if="order.items.some((i) => !i.sentAt && !i.voidedAt)" class="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">{{ t('pos.toSend') }}</span>
                  </span>
                  <span>{{ money(order.total) }}</span>
                </button>
              </div>
            </div>

            <div class="card min-h-0 min-w-0 flex-1 flex-col gap-3 p-3 xl:flex" :class="view === 'products' ? 'flex' : 'hidden'" data-testid="pos-products">
              <div class="flex shrink-0 gap-2 overflow-x-auto pb-1">
                <button type="button" class="chip" :class="!categoryFilter ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-300'" @click="categoryFilter = 0">
                  {{ t('common.all') }}
                </button>
                <button
                  v-for="[id, name] in categories"
                  :key="id"
                  type="button"
                  class="chip"
                  :class="categoryFilter === id ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-300'"
                  @click="categoryFilter = id"
                >
                  {{ name }}
                </button>
              </div>
              <p v-if="!current" class="shrink-0 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ t('pos.pickOrder') }}</p>
              <div class="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 overflow-y-auto touch:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] touch:gap-3">
                <button
                  v-for="product in visibleProducts"
                  :key="product.id"
                  type="button"
                  class="relative flex min-h-24 touch-manipulation flex-col justify-between rounded-xl border-l-8 bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 transition select-none hover:shadow active:scale-[0.98] disabled:opacity-40 touch:min-h-28"
                  :class="categoryColor(product.categoryId)"
                  :disabled="!current || busy"
                  @click="addItem(product)"
                >
                  <img v-if="product.imageFile" :src="fileUrl(product.imageFile)" alt="" class="mb-2 h-16 w-full rounded-md object-cover" loading="lazy" />
                  <span class="line-clamp-2 text-sm font-medium text-slate-800 touch:text-base" :title="product.name">{{ product.name }}</span>
                  <span class="mt-1 font-semibold text-indigo-700 tabular-nums touch:text-lg">{{ money(product.price) }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside class="card flex min-h-0 flex-col p-0 lg:w-80 lg:flex-none xl:w-96" data-testid="pos-order">
          <template v-if="current">
            <div class="flex shrink-0 items-start justify-between gap-2 border-b border-slate-100 p-3">
              <div class="min-w-0">
                <h2 class="truncate text-lg font-semibold">{{ current.tableLabel ?? t('pos.order', { id: current.id }) }}</h2>
                <div v-if="tableChecks.length > 1" class="mt-1 flex flex-wrap gap-1">
                  <button
                    v-for="(check, index) in tableChecks"
                    :key="check.id"
                    type="button"
                    class="min-h-9 touch-manipulation rounded-full px-3 text-xs"
                    :class="check.id === current.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'"
                    @click="current = check; closing = false; moving.active = false"
                  >
                    {{ t('pos.check', { n: index + 1 }) }} · {{ money(check.total) }}
                  </button>
                </div>
              </div>
              <button class="btn-secondary min-h-9 shrink-0 px-3 text-xs text-rose-600" type="button" :disabled="busy" @click="cancelOrder">{{ t('pos.cancelOrder') }}</button>
            </div>

            <form v-if="closing" id="pos-close" class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm" @submit.prevent="confirmClose">
              <CashRequired :registers="registers" />
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="chip justify-center" :class="close.mode === 'PAY' ? 'bg-indigo-600 text-white' : 'bg-white ring-1 ring-slate-300'" @click="close.mode = 'PAY'">{{ t('pos.payNow') }}</button>
                <button type="button" class="chip justify-center disabled:opacity-40" :class="close.mode === 'ROOM' ? 'bg-indigo-600 text-white' : 'bg-white ring-1 ring-slate-300'" :disabled="!inHouse.length" @click="close.mode = 'ROOM'">
                  {{ t('pos.chargeRoom') }}
                </button>
              </div>
              <select v-if="close.mode === 'ROOM'" v-model.number="close.reservationId" class="input">
                <option v-for="reservation in inHouse" :key="reservation.id" :value="reservation.id">
                  {{ t('dashboard.room', { number: reservation.room.number }) }} · {{ reservation.guest.firstName }} {{ reservation.guest.lastName }}
                </option>
              </select>
              <template v-else>
                <div v-for="(payment, index) in close.payments" :key="index" class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div class="flex gap-2">
                    <input v-model.number="payment.amount" class="input text-lg font-semibold tabular-nums" type="number" inputmode="decimal" min="0.01" step="0.01" :aria-label="t('pos.amount')" />
                    <button class="btn-secondary shrink-0 px-3" type="button" @click="exactAmount(index)">{{ t('pos.exact') }}</button>
                  </div>
                  <PaymentTypeSelect
                    v-model:type-id="payment.paymentTypeId"
                    v-model:cash-session-id="payment.cashSessionId"
                    v-model:reference="payment.reference"
                    :registers="registers"
                    buttons
                  />
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button class="btn-secondary px-3" type="button" @click="addPaymentLine">{{ t('pos.splitPayment') }}</button>
                  <label class="flex items-center gap-1">
                    {{ t('pos.splitBy') }}
                    <input v-model.number="people" class="input w-16" type="number" inputmode="numeric" min="2" max="50" :aria-label="t('pos.people')" />
                    {{ t('pos.people') }}
                  </label>
                  <button class="btn-secondary px-3" type="button" @click="splitByPeople">{{ t('pos.apply') }}</button>
                </div>
                <p class="font-medium" :class="Math.abs(paidTotal - Number(current.total)) < 0.005 ? 'text-emerald-700' : 'text-rose-600'">
                  {{ t('pos.paidOf', { paid: money(paidTotal), total: money(current.total) }) }}
                </p>
                <input v-model="close.customerTaxId" class="input" :placeholder="t('pos.taxId')" />
              </template>
            </form>

            <ul v-else class="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto px-3 text-sm">
              <li v-for="item in current.items" :key="item.id" class="py-2" :class="item.voidedAt ? 'text-slate-400' : ''">
                <div class="flex items-start justify-between gap-2">
                  <span class="min-w-0" :class="item.voidedAt ? 'line-through' : ''">
                    <input
                      v-if="moving.active && !item.voidedAt"
                      class="mr-1 size-5 align-middle"
                      type="checkbox"
                      :checked="(moving.quantities[item.id] ?? 0) > 0"
                      :aria-label="t('pos.moveItem', { name: item.description })"
                      @change="toggleMoveLine(item)"
                    />
                    <span class="font-medium">{{ item.description }}</span>
                    <span
                      v-if="!item.voidedAt"
                      class="ml-1 rounded px-1 text-xs"
                      :class="item.readyAt ? 'bg-sky-100 text-sky-800' : item.sentAt ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
                    >
                      {{ item.readyAt ? t('pos.ready') : item.sentAt ? (station(item) === 'BAR' ? t('pos.atBar') : station(item) === 'NONE' ? t('pos.served') : t('pos.atKitchen')) : t('pos.toSend') }}
                    </span>
                  </span>
                  <span class="shrink-0 font-semibold tabular-nums">{{ item.voidedAt ? t('pos.voidedLabel') : money(item.total) }}</span>
                </div>
                <div v-if="moving.active && (moving.quantities[item.id] ?? 0) > 0 && Number(item.quantity) > 1" class="mt-1">
                  <input
                    v-model.number="moving.quantities[item.id]"
                    class="input w-24"
                    type="number"
                    inputmode="decimal"
                    min="0.001"
                    :max="Number(item.quantity)"
                    step="1"
                    :aria-label="t('pos.moveQuantity')"
                  />
                </div>
                <div v-else-if="!item.voidedAt && !moving.active" class="mt-1 flex items-center gap-1">
                  <template v-if="!item.sentAt">
                    <button class="btn-icon ring-1 ring-slate-200" type="button" :disabled="busy" :aria-label="t('pos.decrease', { name: item.description })" @click="changeQuantity(item, -1)">
                      {{ Number(item.quantity) > 1 ? '−' : '×' }}
                    </button>
                    <span class="min-w-10 text-center text-base font-semibold tabular-nums">{{ Number(item.quantity) }}</span>
                    <button class="btn-icon ring-1 ring-slate-200" type="button" :disabled="busy" :aria-label="t('pos.increase', { name: item.description })" @click="changeQuantity(item, 1)">+</button>
                    <button class="btn-secondary ml-auto min-h-11 px-3 text-xs" type="button" :disabled="busy" @click="addNote(item)">{{ t('pos.note') }}</button>
                  </template>
                  <template v-else>
                    <span class="text-slate-500 tabular-nums">{{ Number(item.quantity) }} ×</span>
                    <button v-if="isManager" class="btn-secondary ml-auto min-h-11 px-3 text-xs text-rose-600" type="button" :disabled="busy" @click="voidItem(item)">{{ t('pos.void') }}</button>
                  </template>
                </div>
                <p v-if="item.notes" class="text-xs text-slate-500">&gt; {{ item.notes }}</p>
                <p v-if="item.voidedAt" class="text-xs">
                  {{ t('pos.voidedBy', { reason: item.voidReason, name: item.voidedBy?.name }) }}
                  <PaperLinks class="ml-1" :params="{ document: 'VOID', orderId: current.id, itemId: item.id }" :title="t('print.documents.VOID')" @error="error = $event" />
                </p>
              </li>
            </ul>

            <div class="shrink-0 space-y-2 border-t border-slate-200 p-3">
              <p class="flex justify-between text-lg font-semibold">
                {{ t('common.total') }} <span class="tabular-nums">{{ money(current.total) }}</span>
              </p>

              <div v-if="moving.active" class="space-y-2 text-sm">
                <p class="text-xs text-slate-500">{{ t('pos.moveHint') }}</p>
                <select v-model="moving.target" class="input">
                  <option value="split">{{ current.tableId ? t('pos.splitTable') : t('pos.splitSale') }}</option>
                  <option v-for="target in moveTargets" :key="target.value" :value="target.value">{{ t('pos.transferTo', { target: target.label }) }}</option>
                </select>
                <div class="grid grid-cols-2 gap-2">
                  <button class="btn-secondary" type="button" @click="moving.active = false">{{ t('common.back') }}</button>
                  <button class="btn" type="button" :disabled="busy || !movingCount" @click="confirmMove">{{ t('pos.moveLines', { n: movingCount }) }}</button>
                </div>
              </div>

              <div v-else-if="closing" class="grid grid-cols-2 gap-2">
                <button class="btn-secondary" type="button" @click="closing = false">{{ t('common.back') }}</button>
                <button class="btn" type="submit" form="pos-close" :disabled="busy || !hasCash">{{ t('common.confirm') }}</button>
              </div>

              <div v-else class="grid grid-cols-2 gap-2">
                <button class="btn col-span-2" type="button" :disabled="busy || !pendingCount" @click="sendOrder">
                  {{ t('pos.send') }}{{ pendingCount ? ` (${pendingCount})` : '' }}
                </button>
                <button class="btn-secondary" type="button" :disabled="!activeItems" @click="prebill">{{ t('pos.prebill') }}</button>
                <button class="btn" type="button" :disabled="!activeItems" @click="startClose">{{ t('pos.closeBill') }}</button>
                <button class="btn-secondary col-span-2" type="button" :disabled="!activeItems" @click="startMove">{{ t('pos.splitMove') }}</button>
                <details class="col-span-2 text-sm">
                  <summary class="flex min-h-11 cursor-pointer touch-manipulation items-center rounded-lg px-2 text-slate-600 select-none hover:bg-slate-50">{{ t('pos.documents') }}</summary>
                  <div class="space-y-2 px-2 pt-1 pb-2">
                    <div class="flex flex-wrap items-center gap-2">
                      {{ t('pos.prebill') }}
                      <PaperLinks :params="{ document: 'PREBILL', orderId: current.id }" :title="t('print.documents.PREBILL')" @error="error = $event" />
                    </div>
                    <div v-if="current.items.some((i) => i.sentAt)" class="flex flex-wrap items-center gap-2">
                      {{ t('print.documents.ORDER') }} · {{ t('pos.atKitchen') }}
                      <PaperLinks :params="{ document: 'ORDER', orderId: current.id, station: 'KITCHEN' }" :title="t('print.documents.ORDER')" @error="error = $event" />
                      · {{ t('pos.atBar') }}
                      <PaperLinks :params="{ document: 'ORDER', orderId: current.id, station: 'BAR' }" :title="t('print.documents.ORDER')" @error="error = $event" />
                    </div>
                    <div v-if="current.items.some((i) => i.sentAt)" class="flex flex-wrap items-center gap-2">
                      {{ t('pos.reprint') }}
                      <button class="btn-secondary min-h-11 px-3 text-xs" type="button" @click="reprint('KITCHEN')">{{ t('pos.atKitchen') }}</button>
                      <button class="btn-secondary min-h-11 px-3 text-xs" type="button" @click="reprint('BAR')">{{ t('pos.atBar') }}</button>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </template>
          <p v-else class="p-6 text-center text-sm text-slate-500">{{ t('pos.noneSelected') }}</p>
        </aside>
      </div>
    </template>
  </section>
</template>

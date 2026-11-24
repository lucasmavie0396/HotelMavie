<script setup lang="ts">
import { isAxiosError } from 'axios';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import TouchDialog from '@/components/TouchDialog.vue';
import { LOCALES, localeTag, setLocale, type Locale } from '@/i18n';
import { errorMessage } from '@/services/api';
import { askConfirm, askText } from '@/services/dialog';
import { fileUrl } from '@/services/files';
import { readTabletToken, saveTabletToken, tabletApi } from '@/services/roomTablet';
import type { Outlet, RoomOrder, RoomServiceStatus } from '@/types';
import { formatMoney } from '@/utils/format';

interface Session {
  hotel: { name: string; currency: string };
  room: { number: string };
  guest: { firstName: string } | null;
  available: boolean;
  reason: 'NO_GUEST' | 'BLOCKED' | null;
  outlets: { outlet: Outlet; hours: string | null; open: boolean }[];
  limit: string | null;
  spent: string;
}

interface MenuProduct {
  id: number;
  name: string;
  price: string;
  imageFile: string | null;
  categoryId: number | null;
  category: { id: number; name: string; sortOrder: number } | null;
  outlets: Outlet[];
}

interface CartLine {
  productId: number;
  name: string;
  price: number;
  quantity: number;
  notes: string;
}

const STEPS: RoomServiceStatus[] = ['PENDING', 'ACCEPTED', 'ON_THE_WAY', 'DELIVERED'];
const IDLE_MS = 3 * 60_000;
const RELOAD_MS = 6 * 3600_000;

const { t, locale } = useI18n();
const token = ref(readTabletToken());
const code = ref('');
const session = ref<Session | null>(null);
const menu = ref<MenuProduct[]>([]);
const orders = ref<RoomOrder[]>([]);
const tab = ref<'menu' | 'orders'>('menu');
const outlet = ref<Outlet>('RESTAURANT');
const category = ref(0);
const cart = reactive<CartLine[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const loadedAt = Date.now();
let lastTouch = Date.now();
let timers: number[] = [];

const money = (value: string | number) => formatMoney(value, session.value?.hotel.currency ?? 'EUR');
const outletInfo = computed(() => session.value?.outlets.find((item) => item.outlet === outlet.value));
const visible = computed(() => menu.value.filter((product) => product.outlets.includes(outlet.value)));
const categories = computed(() => {
  const map = new Map<number, { id: number; name: string; sortOrder: number }>();
  for (const product of visible.value) if (product.category) map.set(product.category.id, product.category);
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
});
const products = computed(() => visible.value.filter((product) => !category.value || product.categoryId === category.value));
const cartTotal = computed(() => cart.reduce((sum, line) => sum + Math.round(line.price * line.quantity * 100) / 100, 0));
const cartCount = computed(() => cart.reduce((sum, line) => sum + line.quantity, 0));
const activeOrders = computed(() => orders.value.filter((order) => ['PENDING', 'ACCEPTED', 'ON_THE_WAY'].includes(order.roomServiceStatus)).length);
const canOrder = computed(() => Boolean(session.value?.available && outletInfo.value?.open));
const hoursLabel = (hours: string | null) => {
  if (!hours) return '';
  const [from, to] = hours.split('-');
  return t('tablet.hours', { from, to });
};
const timeOf = (value: string) => new Date(value).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });
const inCart = (productId: number) => cart.filter((line) => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0);

function handleError(e: unknown) {
  if (isAxiosError(e) && e.response?.status === 401) {
    saveTabletToken(null);
    token.value = null;
    session.value = null;
    return;
  }
  error.value = errorMessage(e);
}

async function refresh(withMenu = false) {
  if (!token.value) return;
  try {
    const [s, o, m] = await Promise.all([
      tabletApi.get<Session>('/session'),
      tabletApi.get<RoomOrder[]>('/orders'),
      withMenu || !menu.value.length ? tabletApi.get<MenuProduct[]>('/menu') : Promise.resolve(null),
    ]);
    session.value = s.data;
    orders.value = o.data;
    if (m) menu.value = m.data;
    if (!s.data.outlets.find((item) => item.outlet === outlet.value)?.open) {
      const open = s.data.outlets.find((item) => item.open);
      if (open) outlet.value = open.outlet;
    }
  } catch (e) {
    handleError(e);
  }
}

async function pair() {
  busy.value = true;
  error.value = '';
  try {
    const { data } = await tabletApi.post<{ token: string; room: string }>('/pair', { code: code.value });
    saveTabletToken(data.token);
    token.value = data.token;
    code.value = '';
    notice.value = t('tablet.paired', { room: data.room });
    await refresh(true);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function press(digit: string) {
  if (digit === 'del') code.value = code.value.slice(0, -1);
  else if (code.value.length < 6) code.value += digit;
}

function chooseOutlet(value: Outlet) {
  outlet.value = value;
  category.value = 0;
}

function add(product: MenuProduct) {
  const line = cart.find((item) => item.productId === product.id && !item.notes);
  if (line) line.quantity = Math.min(line.quantity + 1, 50);
  else cart.push({ productId: product.id, name: product.name, price: Number(product.price), quantity: 1, notes: '' });
}

function change(line: CartLine, delta: number) {
  line.quantity += delta;
  if (line.quantity <= 0) cart.splice(cart.indexOf(line), 1);
}

async function note(line: CartLine) {
  const value = await askText({ title: t('tablet.noteTitle', { name: line.name }), message: t('tablet.notePlaceholder'), value: line.notes, multiline: true });
  if (value !== null) line.notes = value.trim().slice(0, 255);
}

async function send() {
  if (!session.value || !cart.length) return;
  const total = money(cartTotal.value);
  if (!(await askConfirm({ title: t('tablet.confirmTitle'), message: t('tablet.confirmMessage', { total, room: session.value.room.number }), confirmLabel: t('tablet.send', { total }) }))) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await tabletApi.post('/orders', {
      outlet: outlet.value,
      items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity, notes: line.notes || undefined })),
    });
    cart.splice(0, cart.length);
    notice.value = t('tablet.sent');
    tab.value = 'orders';
    await refresh();
  } catch (e) {
    handleError(e);
  } finally {
    busy.value = false;
  }
}

async function unpair() {
  if (!(await askConfirm({ title: t('tablet.unpair'), message: t('tablet.unpairConfirm'), danger: true, confirmLabel: t('tablet.unpair') }))) return;
  saveTabletToken(null);
  token.value = null;
  session.value = null;
}

function fullscreen() {
  document.documentElement.requestFullscreen?.().catch(() => undefined);
}

function touched() {
  lastTouch = Date.now();
}

function idleCheck() {
  if (Date.now() - lastTouch < IDLE_MS) return;
  if (cart.length) cart.splice(0, cart.length);
  tab.value = 'menu';
  category.value = 0;
  notice.value = '';
  error.value = '';
  if (Date.now() - loadedAt > RELOAD_MS) window.location.reload();
}

function stepIndex(status: RoomServiceStatus) {
  return STEPS.indexOf(status);
}

onMounted(() => {
  document.title = t('tablet.title');
  refresh(true);
  timers = [window.setInterval(() => refresh(), 15_000), window.setInterval(() => refresh(true), 5 * 60_000), window.setInterval(idleCheck, 30_000)];
  document.addEventListener('pointerdown', touched, { capture: true });
});

onBeforeUnmount(() => {
  timers.forEach((timer) => window.clearInterval(timer));
  document.removeEventListener('pointerdown', touched, { capture: true });
});
</script>

<template>
  <main class="flex min-h-dvh flex-col bg-slate-100 text-slate-900 select-none" data-touch>
    <section v-if="!token" class="m-auto w-full max-w-md space-y-5 p-6 text-center">
      <h1 class="text-2xl font-bold">{{ t('tablet.pairTitle') }}</h1>
      <p class="text-slate-600">{{ t('tablet.pairHint') }}</p>
      <p class="h-16 rounded-2xl bg-white font-mono text-5xl leading-[4rem] font-bold tracking-[0.4em] text-indigo-700 shadow-inner" :aria-label="t('tablet.pairCode')" data-testid="tablet-code">
        {{ code.padEnd(6, '·') }}
      </p>
      <div class="grid grid-cols-3 gap-3">
        <button v-for="digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="digit" type="button" class="min-h-16 rounded-2xl bg-white text-3xl font-semibold shadow active:scale-95" @click="press(digit)">
          {{ digit }}
        </button>
        <button type="button" class="min-h-16 rounded-2xl bg-white text-2xl shadow active:scale-95" :aria-label="t('common.delete')" @click="press('del')">⌫</button>
        <button type="button" class="min-h-16 rounded-2xl bg-white text-3xl font-semibold shadow active:scale-95" @click="press('0')">0</button>
        <button type="button" class="min-h-16 rounded-2xl bg-indigo-600 text-lg font-semibold text-white shadow active:scale-95 disabled:opacity-40" :disabled="code.length !== 6 || busy" @click="pair">
          {{ t('tablet.pair') }}
        </button>
      </div>
      <p v-if="error" class="rounded-xl bg-rose-50 px-4 py-3 text-rose-700">{{ error }}</p>
    </section>

    <template v-else-if="session">
      <header class="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-indigo-700 to-violet-600 px-5 py-4 text-white">
        <div class="min-w-0">
          <p class="truncate text-sm text-indigo-100">{{ session.hotel.name }}</p>
          <h1 class="text-2xl font-bold">
            {{ t('tablet.room', { number: session.room.number }) }}
            <span v-if="session.guest" class="font-normal text-indigo-100">· {{ t('tablet.hello', { name: session.guest.firstName }) }}</span>
          </h1>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex rounded-xl bg-white/15 p-1" role="group" :aria-label="t('tablet.language')">
            <button
              v-for="item in LOCALES"
              :key="item.value"
              type="button"
              class="min-h-11 min-w-12 rounded-lg px-3 font-semibold"
              :class="locale === item.value ? 'bg-white text-indigo-700' : 'text-white'"
              @click="setLocale(item.value as Locale)"
            >
              {{ item.label }}
            </button>
          </div>
          <button type="button" class="min-h-11 rounded-xl bg-white/15 px-4 font-medium" @click="fullscreen">{{ t('tablet.fullscreen') }}</button>
          <button type="button" class="min-h-11 rounded-xl px-3 text-sm text-indigo-100" @click="unpair">{{ t('tablet.unpair') }}</button>
        </div>
      </header>

      <section v-if="!session.available" class="m-auto max-w-lg p-8 text-center">
        <h2 class="text-3xl font-bold">{{ t('tablet.unavailable') }}</h2>
        <p class="mt-3 text-xl text-slate-600">{{ t(`tablet.${session.reason}`) }}</p>
      </section>

      <template v-else>
        <nav class="flex shrink-0 gap-2 px-5 pt-4" role="tablist">
          <button type="button" role="tab" class="min-h-12 rounded-xl px-5 text-lg font-semibold" :aria-selected="tab === 'menu'" :class="tab === 'menu' ? 'bg-slate-900 text-white' : 'bg-white'" @click="tab = 'menu'">
            {{ t('tablet.menu') }}
          </button>
          <button type="button" role="tab" class="min-h-12 rounded-xl px-5 text-lg font-semibold" :aria-selected="tab === 'orders'" :class="tab === 'orders' ? 'bg-slate-900 text-white' : 'bg-white'" @click="tab = 'orders'">
            {{ t('tablet.myOrders') }}
            <span v-if="activeOrders" class="ml-1 rounded-full bg-amber-400 px-2 text-sm text-amber-950">{{ activeOrders }}</span>
          </button>
        </nav>

        <p v-if="notice" class="mx-5 mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-800">{{ notice }}</p>
        <p v-if="error" class="mx-5 mt-3 rounded-xl bg-rose-50 px-4 py-3 text-rose-700">{{ error }}</p>

        <div v-if="tab === 'menu'" class="flex min-h-0 flex-1 flex-col gap-4 p-5 lg:flex-row">
          <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="item in session.outlets"
                :key="item.outlet"
                type="button"
                class="min-h-14 rounded-2xl px-4 text-left shadow-sm"
                :class="outlet === item.outlet ? 'bg-indigo-600 text-white' : 'bg-white'"
                @click="chooseOutlet(item.outlet)"
              >
                <span class="block text-lg font-semibold">{{ t(`labels.outlet.${item.outlet}`) }}</span>
                <span v-if="item.hours" class="block text-sm opacity-80">{{ item.open ? hoursLabel(item.hours) : t('tablet.closedNow', { hours: hoursLabel(item.hours) }) }}</span>
              </button>
            </div>
            <div class="flex gap-2 overflow-x-auto pb-1">
              <button type="button" class="min-h-12 shrink-0 rounded-full px-5 font-medium" :class="!category ? 'bg-slate-900 text-white' : 'bg-white'" @click="category = 0">{{ t('tablet.all') }}</button>
              <button
                v-for="item in categories"
                :key="item.id"
                type="button"
                class="min-h-12 shrink-0 rounded-full px-5 font-medium"
                :class="category === item.id ? 'bg-slate-900 text-white' : 'bg-white'"
                @click="category = item.id"
              >
                {{ item.name }}
              </button>
            </div>
            <div class="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 overflow-y-auto">
              <button
                v-for="product in products"
                :key="product.id"
                type="button"
                class="relative flex flex-col overflow-hidden rounded-2xl bg-white text-left shadow-sm transition active:scale-[0.98] disabled:opacity-50"
                :disabled="!canOrder"
                :aria-label="t('tablet.add', { name: product.name })"
                @click="add(product)"
              >
                <img v-if="product.imageFile" :src="fileUrl(product.imageFile)" alt="" class="h-32 w-full object-cover" loading="lazy" />
                <div v-else class="flex h-20 items-center justify-center bg-gradient-to-br from-indigo-50 to-violet-100 text-3xl font-bold text-indigo-300">{{ product.name.charAt(0) }}</div>
                <span class="flex flex-1 flex-col justify-between gap-1 p-3">
                  <span class="line-clamp-2 text-lg leading-snug font-medium">{{ product.name }}</span>
                  <span class="text-xl font-bold text-indigo-700 tabular-nums">{{ money(product.price) }}</span>
                </span>
                <span v-if="inCart(product.id)" class="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-indigo-600 text-lg font-bold text-white shadow">{{ inCart(product.id) }}</span>
              </button>
            </div>
          </section>

          <aside class="flex min-h-0 flex-col rounded-2xl bg-white shadow-sm lg:w-96 lg:flex-none" data-testid="tablet-cart">
            <h2 class="border-b border-slate-100 px-4 py-3 text-xl font-semibold">{{ t('tablet.cart') }}</h2>
            <ul class="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto px-4">
              <li v-if="!cart.length" class="py-8 text-center text-slate-500">{{ t('tablet.emptyCart') }}</li>
              <li v-for="(line, index) in cart" :key="index" class="space-y-2 py-3">
                <div class="flex justify-between gap-2 text-lg">
                  <span class="font-medium">{{ line.name }}</span>
                  <span class="font-semibold tabular-nums">{{ money(line.price * line.quantity) }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <button type="button" class="size-12 rounded-xl bg-slate-100 text-2xl" :aria-label="t('tablet.decrease', { name: line.name })" @click="change(line, -1)">{{ line.quantity > 1 ? '−' : '×' }}</button>
                  <span class="min-w-10 text-center text-xl font-semibold tabular-nums">{{ line.quantity }}</span>
                  <button type="button" class="size-12 rounded-xl bg-slate-100 text-2xl" :aria-label="t('tablet.increase', { name: line.name })" :disabled="line.quantity >= 50" @click="change(line, 1)">+</button>
                  <button type="button" class="ml-auto min-h-12 rounded-xl bg-slate-100 px-4" @click="note(line)">{{ t('tablet.note') }}</button>
                </div>
                <p v-if="line.notes" class="text-sm text-slate-500">&gt; {{ line.notes }}</p>
              </li>
            </ul>
            <div class="space-y-2 border-t border-slate-200 p-4">
              <p class="flex justify-between text-2xl font-bold tabular-nums"><span>{{ t('common.total') }}</span><span>{{ money(cartTotal) }}</span></p>
              <p class="text-sm text-slate-500">{{ t('tablet.chargedTo', { room: session.room.number }) }}</p>
              <button type="button" class="min-h-16 w-full rounded-2xl bg-indigo-600 text-xl font-semibold text-white shadow active:scale-[0.99] disabled:opacity-40" :disabled="!cartCount || !canOrder || busy" @click="send">
                {{ t('tablet.send', { total: money(cartTotal) }) }}
              </button>
            </div>
          </aside>
        </div>

        <section v-else class="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <p class="text-lg text-slate-700">
            {{ t('tablet.spent', { total: money(session.spent) }) }}
            <template v-if="session.limit"> · {{ t('tablet.limit', { total: money(session.limit) }) }}</template>
          </p>
          <p v-if="!orders.length" class="rounded-2xl bg-white p-8 text-center text-lg text-slate-500">{{ t('tablet.noOrders') }}</p>
          <article v-for="order in orders" :key="order.id" class="space-y-3 rounded-2xl bg-white p-4 shadow-sm" :data-testid="`tablet-order-${order.id}`">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-lg font-semibold">{{ t(`labels.outlet.${order.outlet}`) }} · {{ t('tablet.orderAt', { time: timeOf(order.openedAt) }) }}</h3>
              <span class="text-xl font-bold tabular-nums">{{ money(order.total) }}</span>
            </div>
            <p v-if="order.roomServiceStatus === 'REJECTED'" class="rounded-xl bg-rose-50 px-3 py-2 font-medium text-rose-700">{{ t('tablet.rejected', { reason: order.rejectReason }) }}</p>
            <ol v-else class="grid grid-cols-4 gap-2 text-center text-sm">
              <li
                v-for="(step, index) in STEPS"
                :key="step"
                class="rounded-xl px-2 py-2 font-medium"
                :class="index < stepIndex(order.roomServiceStatus) ? 'bg-emerald-100 text-emerald-800' : index === stepIndex(order.roomServiceStatus) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'"
              >
                {{ t(`tablet.statuses.${step}`) }}
              </li>
            </ol>
            <ul class="text-slate-700">
              <li v-for="item in order.items.filter((line) => !line.voidedAt)" :key="item.id">
                {{ Number(item.quantity) }} × {{ item.description }}<span v-if="item.notes" class="text-sm text-slate-500"> ({{ item.notes }})</span>
              </li>
            </ul>
          </article>
        </section>
      </template>
    </template>

    <p v-else class="m-auto text-lg text-slate-500">{{ error || '…' }}</p>
    <TouchDialog />
  </main>
</template>

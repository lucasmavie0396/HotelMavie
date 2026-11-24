<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { askConfirm, askText } from '@/services/dialog';
import { printDocument } from '@/services/print';
import { useHotelsStore } from '@/stores/hotels';
import type { RoomOrder, RoomServiceStatus } from '@/types';
import { formatMoney } from '@/utils/format';
import { localeTag } from '@/i18n';

const props = defineProps<{ orders: RoomOrder[] }>();
const emit = defineEmits<{ changed: [] }>();

const COLUMNS: RoomServiceStatus[] = ['PENDING', 'ACCEPTED', 'ON_THE_WAY'];
const STATUS_CLASSES: Record<RoomServiceStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-900',
  ACCEPTED: 'bg-sky-100 text-sky-900',
  ON_THE_WAY: 'bg-violet-100 text-violet-900',
  DELIVERED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-800',
};

const { t } = useI18n();
const hotels = useHotelsStore();
const busy = ref(false);
const error = ref('');
const notice = ref('');
const now = ref(Date.now());
let clock = 0;

const money = (value: string | number) => formatMoney(value, hotels.currency);
const column = (status: RoomServiceStatus) => props.orders.filter((order) => order.roomServiceStatus === status);
const recent = computed(() => props.orders.filter((order) => order.roomServiceStatus === 'DELIVERED' || order.roomServiceStatus === 'REJECTED').reverse());
const minutes = (value: string) => Math.max(0, Math.round((now.value - new Date(value).getTime()) / 60_000));
const time = (value: string) => new Date(value).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });
const guest = (order: RoomOrder) => (order.reservation ? `${order.reservation.guest.firstName} ${order.reservation.guest.lastName}` : '-');
const room = (order: RoomOrder) => order.room?.number ?? '-';

async function run(action: () => Promise<unknown>, message: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    notice.value = message;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
    emit('changed');
  }
}

const accept = (order: RoomOrder) =>
  run(async () => {
    const { data } = await api.post<{ sentAt: string; targets: { station: 'KITCHEN' | 'BAR' | 'NONE'; printerId: number | null }[] }>(`/room-orders/${order.id}/accept`);
    const screens = await api
      .get<{ stations: string[] }>('/kds/printing', { params: { hotelId: hotels.selectedId } })
      .then((response) => response.data.stations)
      .catch(() => [] as string[]);
    for (const target of data.targets.filter((item) => !screens.includes(item.station))) {
      await printDocument({ document: 'ORDER', orderId: order.id, station: target.station, printerId: target.printerId, sentAt: data.sentAt });
    }
  }, t('roomOrders.accepted'));

async function reject(order: RoomOrder) {
  const reason = await askText({
    title: t('roomOrders.rejectTitle', { room: room(order) }),
    message: t('roomOrders.rejectPrompt'),
    required: true,
    danger: true,
    confirmLabel: t('roomOrders.reject'),
  });
  if (!reason?.trim()) return;
  await run(() => api.post(`/room-orders/${order.id}/reject`, { reason: reason.trim() }), t('roomOrders.rejected'));
}

const dispatch = (order: RoomOrder) => run(() => api.post(`/room-orders/${order.id}/dispatch`), t('roomOrders.statuses.ON_THE_WAY'));

async function deliver(order: RoomOrder) {
  const confirmed = await askConfirm({
    title: t('roomOrders.deliverTitle', { room: room(order) }),
    message: t('roomOrders.deliverMessage', { total: money(order.total), guest: guest(order) }),
    confirmLabel: t('roomOrders.deliver'),
  });
  if (!confirmed) return;
  await run(() => api.post(`/room-orders/${order.id}/deliver`), t('roomOrders.delivered'));
}

onMounted(() => (clock = window.setInterval(() => (now.value = Date.now()), 30_000)));
onBeforeUnmount(() => window.clearInterval(clock));
</script>

<template>
  <div class="space-y-3" data-testid="room-orders">
    <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
    <p v-if="notice" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{{ notice }}</p>

    <div class="grid gap-3 lg:grid-cols-3">
      <section v-for="status in COLUMNS" :key="status" class="space-y-2">
        <h2 class="flex items-center justify-between text-sm font-semibold text-slate-700">
          {{ t(`roomOrders.statuses.${status}`) }}
          <span class="rounded-full px-2 text-xs" :class="STATUS_CLASSES[status]">{{ column(status).length }}</span>
        </h2>
        <article
          v-for="order in column(status)"
          :key="order.id"
          class="card space-y-2 p-3"
          :class="status === 'PENDING' ? 'ring-2 ring-amber-300' : ''"
          :data-testid="`room-order-${order.id}`"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="text-lg font-bold">{{ t('tablet.room', { number: room(order) }) }}</h3>
              <p class="truncate text-sm text-slate-600">{{ guest(order) }} · {{ t(`labels.outlet.${order.outlet}`) }}</p>
            </div>
            <span class="text-right text-xs text-slate-500">
              {{ time(order.openedAt) }}
              <span class="block font-semibold" :class="minutes(order.openedAt) >= 20 ? 'text-rose-600' : ''">{{ t('roomOrders.since', { n: minutes(order.openedAt) }) }}</span>
            </span>
          </div>
          <ul class="text-sm">
            <li v-for="item in order.items.filter((line) => !line.voidedAt)" :key="item.id">
              <strong class="tabular-nums">{{ Number(item.quantity) }} ×</strong> {{ item.description }}
              <span v-if="item.notes" class="block pl-6 text-xs text-slate-500">&gt; {{ item.notes }}</span>
            </li>
          </ul>
          <p v-if="order.notes" class="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">{{ order.notes }}</p>
          <p class="flex justify-between font-semibold tabular-nums"><span>{{ t('common.total') }}</span><span>{{ money(order.total) }}</span></p>
          <div class="grid grid-cols-2 gap-2">
            <template v-if="status === 'PENDING'">
              <button class="btn-secondary text-rose-700" type="button" :disabled="busy" @click="reject(order)">{{ t('roomOrders.reject') }}</button>
              <button class="btn" type="button" :disabled="busy" @click="accept(order)">{{ t('roomOrders.accept') }}</button>
            </template>
            <template v-else>
              <button v-if="status === 'ACCEPTED'" class="btn-secondary" type="button" :disabled="busy" @click="dispatch(order)">{{ t('roomOrders.dispatch') }}</button>
              <button class="btn" :class="status === 'ACCEPTED' ? '' : 'col-span-2'" type="button" :disabled="busy" @click="deliver(order)">{{ t('roomOrders.deliver') }}</button>
            </template>
          </div>
        </article>
        <p v-if="!column(status).length" class="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400">{{ t('roomOrders.empty') }}</p>
      </section>
    </div>

    <section v-if="recent.length" class="card p-0">
      <h2 class="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">{{ t('roomOrders.recent') }}</h2>
      <ul class="divide-y divide-slate-100 text-sm">
        <li v-for="order in recent" :key="order.id" class="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
          <span>
            <strong>{{ t('tablet.room', { number: room(order) }) }}</strong> · {{ time(order.openedAt) }} · {{ order.items.length }}
            <span v-if="order.rejectReason" class="text-slate-500">· {{ order.rejectReason }}</span>
          </span>
          <span class="flex items-center gap-2">
            <span class="tabular-nums">{{ money(order.total) }}</span>
            <span class="rounded-full px-2 py-0.5 text-xs" :class="STATUS_CLASSES[order.roomServiceStatus]">{{ t(`roomOrders.statuses.${order.roomServiceStatus}`) }}</span>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

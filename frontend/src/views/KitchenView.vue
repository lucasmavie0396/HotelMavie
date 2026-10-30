<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { KdsCard } from '@/types';
import { formatDateTime } from '@/utils/format';

type Station = 'KITCHEN' | 'BAR';

const STATION_KEY = 'mavie.kdsStation';
const { t } = useI18n();
const hotels = useHotelsStore();
const station = ref<Station>(readStation());
const pending = ref<KdsCard[]>([]);
const done = ref<KdsCard[]>([]);
const error = ref('');
const busy = ref(false);
const now = ref(Date.now());
const root = ref<HTMLElement | null>(null);
let poll: ReturnType<typeof setInterval> | undefined;
let clock: ReturnType<typeof setInterval> | undefined;

const waiting = computed(() => pending.value.reduce((sum, card) => sum + card.items.filter((item) => !item.voided && !item.readyAt).length, 0));

function readStation(): Station {
  try {
    return localStorage.getItem(STATION_KEY) === 'BAR' ? 'BAR' : 'KITCHEN';
  } catch {
    return 'KITCHEN';
  }
}

function setStation(value: Station) {
  station.value = value;
  try {
    localStorage.setItem(STATION_KEY, value);
  } catch {
    return;
  } finally {
    load();
  }
}

async function load() {
  try {
    const { data } = await api.get<{ pending: KdsCard[]; done: KdsCard[] }>('/kds', { params: { hotelId: hotels.selectedId, station: station.value } });
    pending.value = data.pending;
    done.value = data.done;
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function mark(itemIds: number[], undo = false) {
  if (!itemIds.length) return;
  busy.value = true;
  try {
    await api.post('/kds/ready', { itemIds, undo });
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const minutes = (card: KdsCard) => Math.max(0, Math.floor((now.value - new Date(card.sentAt).getTime()) / 60000));
const urgency = (card: KdsCard) => (minutes(card) >= 20 ? 'border-rose-500 bg-rose-50' : minutes(card) >= 10 ? 'border-amber-400 bg-amber-50' : 'border-emerald-400 bg-white');
const open = (card: KdsCard) => card.items.filter((item) => !item.readyAt).map((item) => item.id);

function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  else root.value?.requestFullscreen().catch(() => undefined);
}

onMounted(() => {
  load();
  poll = setInterval(load, 10_000);
  clock = setInterval(() => (now.value = Date.now()), 30_000);
});

onBeforeUnmount(() => {
  clearInterval(poll);
  clearInterval(clock);
});
</script>

<template>
  <section ref="root" class="space-y-4 overflow-y-auto bg-slate-100 p-1">
    <PageHeader section="kitchen" :subtitle="t('kitchen.subtitle', { orders: pending.length, items: waiting })">
      <div class="flex rounded-lg bg-white p-0.5 text-sm text-slate-700 shadow">
        <button type="button" class="rounded px-4 py-1.5" :class="station === 'KITCHEN' ? 'bg-indigo-600 text-white' : ''" @click="setStation('KITCHEN')">{{ t('labels.prepStation.KITCHEN') }}</button>
        <button type="button" class="rounded px-4 py-1.5" :class="station === 'BAR' ? 'bg-indigo-600 text-white' : ''" @click="setStation('BAR')">{{ t('labels.prepStation.BAR') }}</button>
      </div>
      <button class="btn-secondary" type="button" @click="fullscreen">{{ t('kitchen.fullscreen') }}</button>
    </PageHeader>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div v-if="pending.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      <article v-for="card in pending" :key="card.key" class="flex flex-col rounded-2xl border-l-8 p-4 shadow" :class="urgency(card)">
        <header class="mb-2 flex items-start justify-between gap-2">
          <div>
            <h2 class="text-xl font-bold">{{ card.table }}</h2>
            <p class="text-xs text-slate-500">{{ t(`labels.outlet.${card.outlet}`) }} · {{ card.waiter ?? '-' }} · {{ formatDateTime(card.sentAt) }}</p>
          </div>
          <span class="rounded-full bg-slate-900 px-2.5 py-1 text-sm font-semibold text-white">{{ minutes(card) }} min</span>
        </header>
        <ul class="flex-1 space-y-1.5">
          <li v-for="item in card.items" :key="item.id" class="flex items-start justify-between gap-2">
            <button
              type="button"
              class="text-left text-lg leading-tight"
              :class="item.voided ? 'text-rose-600 line-through' : item.readyAt ? 'text-slate-400 line-through' : 'font-semibold'"
              :disabled="busy || item.voided"
              :title="item.readyAt ? t('kitchen.undo') : t('kitchen.markItem')"
              @click="mark([item.id], Boolean(item.readyAt))"
            >
              {{ Number(item.quantity) }}x {{ item.description }}
              <span v-if="item.voided" class="ml-1 text-xs font-bold no-underline">{{ t('kitchen.voided') }}</span>
              <span v-if="item.notes" class="block text-sm font-normal text-amber-700">&gt; {{ item.notes }}</span>
            </button>
          </li>
        </ul>
        <button class="btn mt-3 w-full justify-center py-3 text-base" type="button" :disabled="busy" @click="mark(open(card))">{{ t('kitchen.ready') }}</button>
      </article>
    </div>
    <p v-else class="rounded-2xl bg-white p-10 text-center text-lg text-slate-500 shadow">{{ t('kitchen.empty') }}</p>

    <div v-if="done.length" class="space-y-2">
      <h2 class="text-sm font-semibold text-slate-600">{{ t('kitchen.done') }}</h2>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="card in done"
          :key="card.key"
          type="button"
          class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-sm hover:border-indigo-400"
          :title="t('kitchen.undo')"
          :disabled="busy"
          @click="mark(card.items.map((item) => item.id), true)"
        >
          <span class="font-semibold">{{ card.table }}</span>
          <span class="block text-xs text-slate-500">{{ t('kitchen.items', { n: card.items.filter((item) => !item.voided).length }) }} · {{ formatDateTime(card.readyAt!) }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import { localeTag } from '@/i18n';
import BarChart from '@/components/charts/BarChart.vue';
import DonutChart from '@/components/charts/DonutChart.vue';
import ReservationActions from '@/components/ReservationActions.vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { DashboardSummary, ReservationSource, RoomStatus } from '@/types';
import { formatDate, formatMoney, RESERVATION_SOURCE_LABELS, ROOM_STATUS_LABELS, ROOM_STATUSES, todayIso } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const router = useRouter();
const summary = ref<DashboardSummary | null>(null);
const error = ref('');
const loading = ref(false);

const ROOM_COLORS: Record<RoomStatus, string> = { AVAILABLE: '#10b981', OCCUPIED: '#f43f5e', CLEANING: '#f59e0b', MAINTENANCE: '#94a3b8' };
const SOURCE_COLORS: Record<ReservationSource, string> = { DESK: '#6366f1', PHONE: '#0ea5e9', EMAIL: '#a855f7', ONLINE: '#14b8a6' };
const REVENUE_SERIES = [
  { key: 'accommodation', name: 'dashboard.series.accommodation', color: '#6366f1' },
  { key: 'restaurant', name: 'dashboard.series.restaurant', color: '#f59e0b' },
  { key: 'bar', name: 'dashboard.series.bar', color: '#ec4899' },
  { key: 'extra', name: 'dashboard.series.extra', color: '#14b8a6' },
] as const;

const seesMoney = computed(() => auth.isManager);
const money = (value: string | number) => formatMoney(value, hotels.currency);
const compactMoney = (value: number) =>
  new Intl.NumberFormat(localeTag(), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const dayLabel = (iso: string) => `${new Date(`${iso}T12:00:00`).toLocaleDateString(localeTag(), { weekday: 'short' })} ${iso.slice(8, 10)}`;
const greeting = computed(() => {
  const hour = new Date().getHours();
  return hour < 12 ? t('dashboard.morning') : hour < 20 ? t('dashboard.afternoon') : t('dashboard.evening');
});
const todayLong = computed(() => new Date().toLocaleDateString(localeTag(), { weekday: 'long', day: 'numeric', month: 'long' }));

interface Tile {
  label: string;
  value: string | number;
  hint: string;
  to: RouteLocationRaw;
  accent: string;
  icon: string;
}

const tiles = computed<Tile[]>(() => {
  const s = summary.value;
  if (!s) return [];
  const list: Tile[] = [
    { label: t('dashboard.tiles.occupancy'), value: `${s.occupancy}%`, hint: t('dashboard.tiles.occupancyHint', { count: s.inHouse, total: s.totalRooms }), to: { name: 'calendar' }, accent: 'from-indigo-500 to-violet-500', icon: 'M3 21V8l9-5 9 5v13M9 21v-6h6v6' },
    { label: t('dashboard.tiles.arrivals'), value: s.kpis.arrivalsToday, hint: t('dashboard.tiles.arrivalsHint'), to: { name: 'reservations', query: { vista: 'chegadas' } }, accent: 'from-sky-500 to-cyan-500', icon: 'M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3' },
    { label: t('dashboard.tiles.departures'), value: s.kpis.departuresToday, hint: t('dashboard.tiles.departuresHint'), to: { name: 'reservations', query: { vista: 'saidas' } }, accent: 'from-orange-500 to-amber-500', icon: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9' },
    { label: t('dashboard.tiles.inHouse'), value: s.inHouse, hint: t('dashboard.tiles.inHouseHint'), to: { name: 'reservations', query: { estado: 'CHECKED_IN' } }, accent: 'from-emerald-500 to-teal-500', icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z' },
    { label: t('dashboard.tiles.pending'), value: s.kpis.pendingRequests, hint: s.kpis.pendingDeposits ? t('dashboard.tiles.pendingDeposits', { n: s.kpis.pendingDeposits }) : t('dashboard.tiles.pendingHint'), to: s.kpis.pendingDeposits ? { name: 'reservations', query: { sinal: 'pendente' } } : { name: 'reservations', query: { estado: 'PENDING' } }, accent: 'from-amber-500 to-yellow-500', icon: 'M12 8v4l3 3M12 21a9 9 0 100-18 9 9 0 000 18z' },
    { label: t('dashboard.tiles.orders'), value: s.kpis.openOrders, hint: t('dashboard.tiles.ordersHint'), to: { name: 'pos' }, accent: 'from-rose-500 to-pink-500', icon: 'M3 11h18M5 11V7a7 7 0 0114 0v4M4 15h16l-1 6H5z' },
    { label: t('dashboard.tiles.registers'), value: s.kpis.openSessions, hint: t('dashboard.tiles.registersHint'), to: { name: 'cash' }, accent: 'from-slate-600 to-slate-800', icon: 'M3 7h18v12H3zM3 11h18M7 15h3' },
  ];
  if (s.kpis.revenueToday !== null) {
    list.splice(1, 0, {
      label: t('dashboard.tiles.revenue'),
      value: money(s.kpis.revenueToday),
      hint: t('dashboard.tiles.revenueHint'),
      to: { name: 'reports', query: { de: todayIso(), ate: todayIso() } },
      accent: 'from-fuchsia-500 to-purple-600',
      icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
    });
  }
  return list;
});

const forecast = computed(() => summary.value?.forecast ?? []);
const revenue = computed(() => summary.value?.revenue ?? []);
const revenueTotal = computed(() =>
  revenue.value.reduce((sum, day) => sum + Number(day.accommodation) + Number(day.restaurant) + Number(day.bar) + Number(day.extra), 0),
);
const roomSegments = computed(() =>
  ROOM_STATUSES.map((status) => ({ key: status, label: ROOM_STATUS_LABELS[status], value: summary.value?.rooms[status] ?? 0, color: ROOM_COLORS[status] })),
);
const sourceSegments = computed(() =>
  (Object.keys(RESERVATION_SOURCE_LABELS) as ReservationSource[]).map((source) => ({
    key: source,
    label: RESERVATION_SOURCE_LABELS[source],
    value: summary.value?.sources.find((item) => item.source === source)?.count ?? 0,
    color: SOURCE_COLORS[source],
  })),
);
const sourcesTotal = computed(() => sourceSegments.value.reduce((sum, item) => sum + item.value, 0));

async function load() {
  loading.value = true;
  try {
    summary.value = (await api.get<DashboardSummary>('/dashboard', { params: { hotelId: hotels.selectedId } })).data;
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

const go = (to: RouteLocationRaw) => router.push(to);

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 text-white shadow-lg">
      <div class="absolute -top-16 -right-10 size-56 rounded-full bg-white/10" />
      <div class="absolute -bottom-20 right-40 size-40 rounded-full bg-white/10" />
      <div class="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-sm text-indigo-100 first-letter:uppercase">{{ todayLong }}</p>
          <h1 class="text-2xl font-semibold">{{ greeting }}, {{ auth.user?.name }}</h1>
          <p v-if="summary" class="mt-1 text-sm text-indigo-100">
            {{ hotels.selected?.name }} · {{ t('dashboard.occupied', { count: summary.inHouse, total: summary.totalRooms }) }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <RouterLink :to="{ name: 'reservations', query: { nova: '1' } }" class="rounded-lg bg-white px-3 py-2 text-sm font-medium text-indigo-700 shadow hover:bg-indigo-50">{{ t('dashboard.newReservation') }}</RouterLink>
          <RouterLink :to="{ name: 'calendar' }" class="rounded-lg bg-white/15 px-3 py-2 text-sm font-medium backdrop-blur hover:bg-white/25">{{ t('nav.calendar') }}</RouterLink>
          <RouterLink :to="{ name: 'pos' }" class="rounded-lg bg-white/15 px-3 py-2 text-sm font-medium backdrop-blur hover:bg-white/25">{{ t('nav.pos') }}</RouterLink>
          <button type="button" class="rounded-lg bg-white/15 px-3 py-2 text-sm font-medium backdrop-blur hover:bg-white/25" :disabled="loading" @click="load">
            {{ loading ? t('dashboard.refreshing') : t('common.update') }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <template v-if="summary">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <RouterLink
          v-for="tile in tiles"
          :key="tile.label"
          :to="tile.to"
          class="group card flex items-center gap-4 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
        >
          <span class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow" :class="tile.accent">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path :d="tile.icon" />
            </svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-xs font-medium tracking-wide text-slate-500 uppercase">{{ tile.label }}</span>
            <span class="block truncate text-2xl font-semibold text-slate-900">{{ tile.value }}</span>
            <span class="block truncate text-xs text-slate-500">{{ tile.hint }}</span>
          </span>
          <span class="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" aria-hidden="true">&rsaquo;</span>
        </RouterLink>
      </div>

      <div class="grid gap-6 xl:grid-cols-3">
        <div class="card space-y-3 xl:col-span-2">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="font-semibold">{{ t('dashboard.forecast') }}</h2>
            <RouterLink :to="{ name: 'calendar' }" class="text-xs text-indigo-600 hover:underline">{{ t('dashboard.openCalendar') }}</RouterLink>
          </div>
          <BarChart
            :description="t('dashboard.forecastDescription')"
            :labels="forecast.map((day) => dayLabel(day.date))"
            :series="[
              { name: t('dashboard.confirmedSeries'), color: '#6366f1', values: forecast.map((day) => day.confirmed) },
              { name: t('dashboard.pendingSeries'), color: '#fbbf24', values: forecast.map((day) => day.pending) },
            ]"
            :max="summary.totalRooms"
            :highlight="0"
            :format="(value) => String(Math.round(value))"
            @select="(index) => go({ name: 'calendar', query: { inicio: forecast[index].date } })"
          />
          <p class="text-xs text-slate-500">{{ t('dashboard.forecastHint') }}</p>
        </div>

        <div class="card space-y-3">
          <div class="flex items-baseline justify-between gap-2">
            <h2 class="font-semibold">{{ t('dashboard.roomStatus') }}</h2>
            <RouterLink :to="{ name: 'rooms' }" class="text-xs text-indigo-600 hover:underline">{{ t('dashboard.seeRooms') }}</RouterLink>
          </div>
          <DonutChart
            :description="t('dashboard.roomStatusDescription')"
            :segments="roomSegments"
            :caption="t('dashboard.roomsCaption')"
            @select="(status) => go({ name: 'rooms', query: { estado: status } })"
          />
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-3">
        <div v-if="seesMoney && summary.revenue" class="card space-y-3 xl:col-span-2">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="font-semibold">{{ t('dashboard.revenue') }} <span class="font-normal text-slate-500">({{ money(revenueTotal) }})</span></h2>
            <RouterLink :to="{ name: 'reports', query: { de: revenue[0]?.date, ate: todayIso() } }" class="text-xs text-indigo-600 hover:underline">{{ t('dashboard.seeReport') }}</RouterLink>
          </div>
          <BarChart
            :description="t('dashboard.revenueDescription')"
            :labels="revenue.map((day) => dayLabel(day.date))"
            :series="REVENUE_SERIES.map((item) => ({ name: t(item.name), color: item.color, values: revenue.map((day) => Number(day[item.key])) }))"
            :highlight="revenue.length - 1"
            :format="compactMoney"
            @select="(index) => go({ name: 'reports', query: { de: revenue[index].date, ate: revenue[index].date } })"
          />
          <p class="text-xs text-slate-500">{{ t('dashboard.revenueHint') }}</p>
        </div>

        <div class="card space-y-3" :class="seesMoney && summary.revenue ? '' : 'xl:col-span-3'">
          <div class="flex items-baseline justify-between gap-2">
            <h2 class="font-semibold">{{ t('dashboard.sources') }}</h2>
            <RouterLink :to="{ name: 'reservations' }" class="text-xs text-indigo-600 hover:underline">{{ t('dashboard.seeReservations') }}</RouterLink>
          </div>
          <DonutChart
            v-if="sourcesTotal"
            :description="t('dashboard.sourcesDescription')"
            :segments="sourceSegments"
            :caption="t('dashboard.reservationsCaption')"
            @select="(source) => go({ name: 'reservations', query: { origem: source } })"
          />
          <p v-else class="py-8 text-center text-sm text-slate-500">{{ t('dashboard.noSources') }}</p>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <div
          v-for="list in [
            { title: t('dashboard.arrivals'), items: summary.arrivals, empty: t('dashboard.noArrivals'), view: 'chegadas', dot: 'bg-sky-500' },
            { title: t('dashboard.departures'), items: summary.departures, empty: t('dashboard.noDepartures'), view: 'saidas', dot: 'bg-orange-500' },
          ]"
          :key="list.title"
          class="card space-y-3"
        >
          <div class="flex items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 font-semibold"><span class="size-2 rounded-full" :class="list.dot" />{{ list.title }} ({{ list.items.length }})</h2>
            <RouterLink :to="{ name: 'reservations', query: { vista: list.view } }" class="text-xs text-indigo-600 hover:underline">{{ t('dashboard.seeAll') }}</RouterLink>
          </div>
          <ul class="divide-y divide-slate-100">
            <li v-for="reservation in list.items" :key="reservation.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
              <RouterLink :to="{ name: 'reservation', params: { id: reservation.id } }" class="text-sm hover:underline">
                <span class="font-medium">{{ t('dashboard.room', { number: reservation.room.number }) }}</span>
                · {{ reservation.guest.firstName }} {{ reservation.guest.lastName }}
                <span class="text-slate-500">· {{ formatDate(reservation.checkIn) }} - {{ formatDate(reservation.checkOut) }}</span>
              </RouterLink>
              <ReservationActions :reservation="reservation" @updated="load" @error="error = $event" />
            </li>
            <li v-if="!list.items.length" class="py-2 text-sm text-slate-500">{{ list.empty }}</li>
          </ul>
        </div>
      </div>
    </template>
  </section>
</template>

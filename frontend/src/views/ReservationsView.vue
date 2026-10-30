<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import NewReservationForm from '@/components/NewReservationForm.vue';
import ReservationActions from '@/components/ReservationActions.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Reservation, ReservationSource, ReservationStatus } from '@/types';
import { formatDate, formatMoney, RESERVATION_SOURCE_LABELS, RESERVATION_STATUS_LABELS, RESERVATION_STATUSES, todayIso } from '@/utils/format';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const hotels = useHotelsStore();
const reservations = ref<Reservation[]>([]);
const error = ref('');
const creating = ref(route.query.nova === '1');

const queryText = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '');
const VIEWS: Record<string, string> = { chegadas: 'reservations.views.arrivals', saidas: 'reservations.views.departures', pendente: 'reservations.views.deposits' };

const filters = reactive({
  status: (RESERVATION_STATUSES.includes(queryText('estado') as ReservationStatus) ? queryText('estado') : '') as ReservationStatus | '',
  from: queryText('de'),
  to: queryText('ate'),
  q: queryText('q'),
});
const source = ref<ReservationSource | ''>(Object.keys(RESERVATION_SOURCE_LABELS).includes(queryText('origem')) ? (queryText('origem') as ReservationSource) : '');
const view = ref(queryText('sinal') === 'pendente' ? 'pendente' : VIEWS[queryText('vista')] ? queryText('vista') : '');

const visible = computed(() => {
  const today = todayIso();
  return reservations.value.filter((reservation) => {
    if (source.value && reservation.source !== source.value) return false;
    if (view.value === 'chegadas') return ['PENDING', 'CONFIRMED'].includes(reservation.status) && reservation.checkIn.slice(0, 10) <= today;
    if (view.value === 'saidas') return reservation.status === 'CHECKED_IN' && reservation.checkOut.slice(0, 10) <= today;
    if (view.value === 'pendente') return reservation.status === 'PENDING' && reservation.depositAmount !== null && !reservation.depositPaymentId;
    return true;
  });
});

function clearView() {
  view.value = '';
  source.value = '';
  router.replace({ query: {} });
  load();
}

async function load() {
  error.value = '';
  const today = todayIso();
  const forView =
    view.value === 'chegadas'
      ? { from: today, to: today }
      : view.value === 'saidas'
        ? { status: 'CHECKED_IN' }
        : view.value === 'pendente'
          ? { status: 'PENDING' }
          : {};
  try {
    reservations.value = (
      await api.get<Reservation[]>('/reservations', {
        params: {
          hotelId: hotels.selectedId,
          status: filters.status || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          q: filters.q || undefined,
          ...forView,
        },
      })
    ).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function replace(updated: Reservation) {
  const index = reservations.value.findIndex((reservation) => reservation.id === updated.id);
  if (index >= 0) {
    reservations.value[index] = updated;
  }
}

async function created(reservation: Reservation) {
  creating.value = false;
  await router.push({ name: 'reservation', params: { id: reservation.id } });
}

function clearFilters() {
  Object.assign(filters, { status: '', from: '', to: '', q: '' });
  clearView();
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="reservations" :subtitle="t('reservations.subtitle')">
      <button class="btn" type="button" @click="creating = !creating">{{ t('dashboard.newReservation') }}</button>
    </PageHeader>

    <div v-if="creating" class="card">
      <NewReservationForm
        :initial-check-in="typeof route.query.entrada === 'string' ? route.query.entrada : undefined"
        :initial-room-id="route.query.quarto ? Number(route.query.quarto) : undefined"
        @created="created"
        @cancel="creating = false"
      />
    </div>

    <form class="card grid gap-3 sm:grid-cols-5" @submit.prevent="load">
      <input v-model="filters.q" class="input sm:col-span-2" :placeholder="t('reservations.search')" />
      <select v-model="filters.status" class="input">
        <option value="">{{ t('reservations.allStatuses') }}</option>
        <option v-for="status in RESERVATION_STATUSES" :key="status" :value="status">
          {{ RESERVATION_STATUS_LABELS[status] }}
        </option>
      </select>
      <input v-model="filters.from" class="input" type="date" :aria-label="t('common.from')" />
      <input v-model="filters.to" class="input" type="date" :aria-label="t('common.to')" />
      <div class="flex justify-end gap-2 sm:col-span-5">
        <button class="btn-secondary" type="button" @click="clearFilters">{{ t('reservations.clear') }}</button>
        <button class="btn" type="submit">{{ t('common.filter') }}</button>
      </div>
    </form>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div v-if="view || source" class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-slate-500">{{ t('reservations.showing') }}</span>
      <span v-if="view" class="rounded-full bg-indigo-100 px-3 py-1 font-medium text-indigo-800">{{ t(VIEWS[view]) }}</span>
      <span v-if="source" class="rounded-full bg-indigo-100 px-3 py-1 font-medium text-indigo-800">{{ t('reservations.sourceFilter', { source: RESERVATION_SOURCE_LABELS[source] }) }}</span>
      <span class="text-slate-500">({{ visible.length }})</span>
      <button class="text-indigo-600 hover:underline" type="button" @click="clearView">{{ t('dashboard.seeAll') }}</button>
    </div>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('reservations.code') }}</th>
            <th class="px-4 py-3">{{ t('reservations.guest') }}</th>
            <th class="px-4 py-3">{{ t('calendar.room') }}</th>
            <th class="px-4 py-3">{{ t('newReservation.checkIn') }}</th>
            <th class="px-4 py-3">{{ t('newReservation.checkOut') }}</th>
            <th class="px-4 py-3">{{ t('common.total') }}</th>
            <th class="px-4 py-3">{{ t('newReservation.source') }}</th>
            <th class="px-4 py-3">{{ t('common.status') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="reservation in visible" :key="reservation.id" class="border-b border-slate-100 last:border-0">
            <td class="px-4 py-3 font-medium">
              <RouterLink :to="{ name: 'reservation', params: { id: reservation.id } }" class="text-indigo-600 hover:underline">
                {{ reservation.code }}
              </RouterLink>
            </td>
            <td class="px-4 py-3">{{ reservation.guest.firstName }} {{ reservation.guest.lastName }}</td>
            <td class="px-4 py-3">{{ reservation.room.number }} <span class="text-slate-500">{{ reservation.room.type }}</span></td>
            <td class="px-4 py-3">{{ formatDate(reservation.checkIn) }}</td>
            <td class="px-4 py-3">{{ formatDate(reservation.checkOut) }}</td>
            <td class="px-4 py-3">{{ formatMoney(reservation.totalAmount, hotels.currency) }}</td>
            <td class="px-4 py-3">{{ RESERVATION_SOURCE_LABELS[reservation.source] }}</td>
            <td class="px-4 py-3">
              <StatusBadge :status="reservation.status" />
              <span v-if="reservation.depositPaymentId" class="mt-1 block text-xs text-emerald-700">{{ t('reservations.depositReceived') }}</span>
              <RouterLink
                v-else-if="reservation.depositAmount !== null && reservation.status === 'PENDING'"
                :to="{ name: 'reservation', params: { id: reservation.id } }"
                class="mt-1 block text-xs font-medium text-amber-700 hover:underline"
              >
                {{ t('reservations.depositPending') }}
              </RouterLink>
            </td>
            <td class="px-4 py-3">
              <ReservationActions :reservation="reservation" @updated="replace" @error="error = $event" />
            </td>
          </tr>
          <tr v-if="!visible.length">
            <td colspan="9" class="px-4 py-6 text-center text-slate-500">{{ t('reservations.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

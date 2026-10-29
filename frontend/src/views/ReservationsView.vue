<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NewReservationForm from '@/components/NewReservationForm.vue';
import ReservationActions from '@/components/ReservationActions.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Reservation, ReservationStatus } from '@/types';
import { formatDate, formatMoney, RESERVATION_SOURCE_LABELS, RESERVATION_STATUS_LABELS, RESERVATION_STATUSES } from '@/utils/format';

const route = useRoute();
const router = useRouter();
const hotels = useHotelsStore();
const reservations = ref<Reservation[]>([]);
const error = ref('');
const creating = ref(route.query.nova === '1');

const filters = reactive({
  status: '' as ReservationStatus | '',
  from: '',
  to: '',
  q: '',
});

async function load() {
  error.value = '';
  try {
    reservations.value = (
      await api.get<Reservation[]>('/reservations', {
        params: {
          hotelId: hotels.selectedId,
          status: filters.status || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          q: filters.q || undefined,
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
  load();
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">Reservas</h1>
      <button class="btn" type="button" @click="creating = !creating">Nova reserva</button>
    </div>

    <div v-if="creating" class="card">
      <NewReservationForm
        :initial-check-in="typeof route.query.entrada === 'string' ? route.query.entrada : undefined"
        :initial-room-id="route.query.quarto ? Number(route.query.quarto) : undefined"
        @created="created"
        @cancel="creating = false"
      />
    </div>

    <form class="card grid gap-3 sm:grid-cols-5" @submit.prevent="load">
      <input v-model="filters.q" class="input sm:col-span-2" placeholder="Codigo ou nome do hospede" />
      <select v-model="filters.status" class="input">
        <option value="">Todos os estados</option>
        <option v-for="status in RESERVATION_STATUSES" :key="status" :value="status">
          {{ RESERVATION_STATUS_LABELS[status] }}
        </option>
      </select>
      <input v-model="filters.from" class="input" type="date" aria-label="De" />
      <input v-model="filters.to" class="input" type="date" aria-label="Ate" />
      <div class="flex justify-end gap-2 sm:col-span-5">
        <button class="btn-secondary" type="button" @click="clearFilters">Limpar</button>
        <button class="btn" type="submit">Filtrar</button>
      </div>
    </form>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">Codigo</th>
            <th class="px-4 py-3">Hospede</th>
            <th class="px-4 py-3">Quarto</th>
            <th class="px-4 py-3">Entrada</th>
            <th class="px-4 py-3">Saida</th>
            <th class="px-4 py-3">Total</th>
            <th class="px-4 py-3">Origem</th>
            <th class="px-4 py-3">Estado</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="reservation in reservations" :key="reservation.id" class="border-b border-slate-100 last:border-0">
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
              <span v-if="reservation.depositPaymentId" class="mt-1 block text-xs text-emerald-700">sinal recebido</span>
              <RouterLink
                v-else-if="reservation.depositAmount !== null && reservation.status === 'PENDING'"
                :to="{ name: 'reservation', params: { id: reservation.id } }"
                class="mt-1 block text-xs font-medium text-amber-700 hover:underline"
              >
                sinal por confirmar
              </RouterLink>
            </td>
            <td class="px-4 py-3">
              <ReservationActions :reservation="reservation" @updated="replace" @error="error = $event" />
            </td>
          </tr>
          <tr v-if="!reservations.length">
            <td colspan="9" class="px-4 py-6 text-center text-slate-500">Sem reservas</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

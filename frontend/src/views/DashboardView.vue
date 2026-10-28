<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ReservationActions from '@/components/ReservationActions.vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { DashboardSummary } from '@/types';
import { formatDate, ROOM_STATUS_CLASSES, ROOM_STATUS_LABELS, ROOM_STATUSES } from '@/utils/format';

const auth = useAuthStore();
const hotels = useHotelsStore();
const summary = ref<DashboardSummary | null>(null);
const error = ref('');

async function load() {
  try {
    summary.value = (await api.get<DashboardSummary>('/dashboard', { params: { hotelId: hotels.selectedId } })).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">Ola, {{ auth.user?.name }}</h1>
      <p v-if="summary" class="text-sm text-slate-500">
        {{ summary.inHouse }} quartos ocupados de {{ summary.totalRooms }} · ocupacao {{ summary.occupancy }}%
      </p>
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <template v-if="summary">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="status in ROOM_STATUSES" :key="status" class="card">
          <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="ROOM_STATUS_CLASSES[status]">
            {{ ROOM_STATUS_LABELS[status] }}
          </span>
          <p class="mt-3 text-3xl font-semibold">{{ summary.rooms[status] }}</p>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <div v-for="list in [
          { title: 'Chegadas pendentes', items: summary.arrivals, empty: 'Sem chegadas pendentes' },
          { title: 'Saidas pendentes', items: summary.departures, empty: 'Sem saidas pendentes' },
        ]" :key="list.title" class="card space-y-3">
          <h2 class="font-semibold">{{ list.title }} ({{ list.items.length }})</h2>
          <ul class="divide-y divide-slate-100">
            <li v-for="reservation in list.items" :key="reservation.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
              <RouterLink :to="{ name: 'reservation', params: { id: reservation.id } }" class="text-sm hover:underline">
                <span class="font-medium">Quarto {{ reservation.room.number }}</span>
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

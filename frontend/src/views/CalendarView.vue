<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { localeTag } from '@/i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Reservation, Room } from '@/types';
import { addDays, RESERVATION_STATUS_CLASSES, todayIso } from '@/utils/format';

const DAYS = 14;

interface Cell {
  key: string;
  span: number;
  date: string;
  reservation?: Reservation;
}

const { t } = useI18n();
const router = useRouter();
const hotels = useHotelsStore();
const initial = useRoute().query.inicio;
const start = ref(typeof initial === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(initial) ? initial : todayIso());
const rooms = ref<Room[]>([]);
const reservations = ref<Reservation[]>([]);
const error = ref('');

const days = computed(() => Array.from({ length: DAYS }, (_, index) => addDays(start.value, index)));
const end = computed(() => addDays(start.value, DAYS));

const rows = computed(() =>
  rooms.value.map((room) => {
    const roomReservations = reservations.value.filter(
      (reservation) => reservation.roomId === room.id && !['CANCELLED', 'NO_SHOW'].includes(reservation.status),
    );
    const cells: Cell[] = [];
    let index = 0;
    while (index < DAYS) {
      const date = days.value[index];
      const reservation = roomReservations.find(
        (item) => item.checkIn.slice(0, 10) <= date && item.checkOut.slice(0, 10) > date,
      );
      if (!reservation) {
        cells.push({ key: `${room.id}-${date}`, span: 1, date });
        index++;
        continue;
      }
      const last = reservation.checkOut.slice(0, 10) < end.value ? reservation.checkOut.slice(0, 10) : end.value;
      const span = days.value.slice(index).filter((day) => day < last).length;
      cells.push({ key: `${room.id}-${date}-${reservation.id}`, span, date, reservation });
      index += span;
    }
    return { room, cells };
  }),
);

function label(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return { weekday: new Date(year, month - 1, day).toLocaleDateString(localeTag(), { weekday: 'short' }), day: `${day}/${month}` };
}

async function load() {
  error.value = '';
  try {
    const [roomsResponse, reservationsResponse] = await Promise.all([
      api.get<Room[]>('/rooms', { params: { hotelId: hotels.selectedId } }),
      api.get<Reservation[]>('/reservations', {
        params: { hotelId: hotels.selectedId, from: start.value, to: addDays(start.value, DAYS - 1) },
      }),
    ]);
    rooms.value = roomsResponse.data;
    reservations.value = reservationsResponse.data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function move(offset: number) {
  start.value = addDays(start.value, offset);
  load();
}

function newReservation(roomId: number, date: string) {
  if (date < todayIso()) {
    return;
  }
  router.push({ name: 'reservations', query: { nova: '1', quarto: roomId, entrada: date } });
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="calendar" :subtitle="t('calendar.subtitle')">
      <button class="btn-secondary" type="button" @click="move(-7)">&larr; {{ t('calendar.days', { n: 7 }) }}</button>
      <input v-model="start" class="input w-auto" type="date" @change="load" />
      <button class="btn-secondary" type="button" @click="start = todayIso(); load()">{{ t('calendar.today') }}</button>
      <button class="btn-secondary" type="button" @click="move(7)">{{ t('calendar.days', { n: 7 }) }} &rarr;</button>
    </PageHeader>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="card overflow-x-auto p-0">
      <table class="w-full table-fixed border-collapse text-xs">
        <thead>
          <tr class="bg-slate-50 text-slate-600">
            <th class="sticky left-0 w-24 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left">{{ t('calendar.room') }}</th>
            <th
              v-for="date in days"
              :key="date"
              class="w-16 border-b border-l border-slate-200 px-1 py-2 text-center font-medium"
              :class="date === todayIso() ? 'bg-indigo-50 text-indigo-700' : ''"
            >
              <span class="block">{{ label(date).weekday }}</span>
              {{ label(date).day }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.room.id">
            <th class="sticky left-0 border-b border-slate-100 bg-white px-3 py-2 text-left font-medium">
              {{ row.room.number }}
              <span class="block font-normal text-slate-500">{{ row.room.type }}</span>
            </th>
            <td
              v-for="cell in row.cells"
              :key="cell.key"
              :colspan="cell.span"
              class="h-12 border-b border-l border-slate-100 p-0.5"
            >
              <RouterLink
                v-if="cell.reservation"
                :to="{ name: 'reservation', params: { id: cell.reservation.id } }"
                class="flex h-full items-center truncate rounded px-2 font-medium"
                :class="RESERVATION_STATUS_CLASSES[cell.reservation.status]"
                :title="`${cell.reservation.code} · ${cell.reservation.guest.firstName} ${cell.reservation.guest.lastName}`"
              >
                {{ cell.reservation.guest.firstName }} {{ cell.reservation.guest.lastName }}
              </RouterLink>
              <button
                v-else
                type="button"
                class="h-full w-full rounded hover:bg-indigo-50"
                :aria-label="t('calendar.newAt', { room: row.room.number, date: cell.date })"
                @click="newReservation(row.room.id, cell.date)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

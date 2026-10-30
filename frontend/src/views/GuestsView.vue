<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import GuestForm from '@/components/GuestForm.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Guest, Reservation } from '@/types';
import { formatDate } from '@/utils/format';

type GuestDetail = Guest & { reservations: (Omit<Reservation, 'guest'>)[] };

const { t } = useI18n();
const hotels = useHotelsStore();
const route = useRoute();
const guests = ref<Guest[]>([]);
const q = ref('');
const error = ref('');
const editing = ref<GuestDetail | null>(null);
const creating = ref(false);

let searchTimer: ReturnType<typeof setTimeout> | undefined;

async function load() {
  try {
    guests.value = (await api.get<Guest[]>('/guests', { params: { hotelId: hotels.selectedId, q: q.value || undefined } })).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function search() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 300);
}

async function open(guest: Guest) {
  creating.value = false;
  try {
    editing.value = (await api.get<GuestDetail>(`/guests/${guest.id}`)).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function startCreate() {
  editing.value = null;
  creating.value = true;
}

function close() {
  editing.value = null;
  creating.value = false;
}

async function saved() {
  close();
  await load();
}

onMounted(async () => {
  await load();
  const id = Number(route.query.id);
  if (Number.isInteger(id) && id > 0) await open({ id } as Guest);
});
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="guests" :subtitle="t('guests.subtitle')">
      <input v-model="q" class="input w-64" :placeholder="t('guests.search')" @input="search" />
      <button class="btn" type="button" @click="startCreate">{{ t('newReservation.newGuest') }}</button>
    </PageHeader>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div v-if="creating || editing" class="card space-y-4">
      <h2 class="font-semibold">{{ editing ? `${editing.firstName} ${editing.lastName}` : t('newReservation.newGuest') }}</h2>
      <GuestForm :guest="editing" @saved="saved" @cancel="close" />
      <div v-if="editing?.reservations.length" class="space-y-2">
        <h3 class="text-sm font-semibold text-slate-600">{{ t('guests.history') }}</h3>
        <ul class="divide-y divide-slate-100 text-sm">
          <li v-for="reservation in editing.reservations" :key="reservation.id" class="flex items-center justify-between py-2">
            <RouterLink :to="{ name: 'reservation', params: { id: reservation.id } }" class="hover:underline">
              {{ reservation.code }} · {{ t('dashboard.room', { number: reservation.room.number }) }} · {{ formatDate(reservation.checkIn) }} - {{ formatDate(reservation.checkOut) }}
            </RouterLink>
            <StatusBadge :status="reservation.status" />
          </li>
        </ul>
      </div>
    </div>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('common.name') }}</th>
            <th class="px-4 py-3">{{ t('common.email') }}</th>
            <th class="px-4 py-3">{{ t('common.phone') }}</th>
            <th class="px-4 py-3">{{ t('guest.document') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="guest in guests"
            :key="guest.id"
            class="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
            @click="open(guest)"
          >
            <td class="px-4 py-3 font-medium">{{ guest.firstName }} {{ guest.lastName }}</td>
            <td class="px-4 py-3">{{ guest.email ?? '-' }}</td>
            <td class="px-4 py-3">{{ guest.phone ?? '-' }}</td>
            <td class="px-4 py-3">{{ [guest.documentType, guest.documentNumber].filter(Boolean).join(' ') || '-' }}</td>
          </tr>
          <tr v-if="!guests.length">
            <td colspan="4" class="px-4 py-6 text-center text-slate-500">{{ t('guests.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

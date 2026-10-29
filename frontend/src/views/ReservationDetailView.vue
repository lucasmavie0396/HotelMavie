<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import DepositPanel from '@/components/DepositPanel.vue';
import FolioPanel from '@/components/FolioPanel.vue';
import ReservationActions from '@/components/ReservationActions.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Reservation } from '@/types';
import { addDays, formatDate, formatMoney, RESERVATION_SOURCE_LABELS } from '@/utils/format';

const route = useRoute();
const hotels = useHotelsStore();
const reservation = ref<Reservation | null>(null);
const error = ref('');
const saving = ref(false);
const edit = reactive({ checkIn: '', checkOut: '', adults: 1, children: 0, pricePerNight: 0, notes: '' });
const folioPanel = ref<InstanceType<typeof FolioPanel> | null>(null);

const editable = computed(() => reservation.value && ['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(reservation.value.status));
const checkedIn = computed(() => reservation.value?.status === 'CHECKED_IN');

function fill(value: Reservation) {
  reservation.value = value;
  Object.assign(edit, {
    checkIn: value.checkIn.slice(0, 10),
    checkOut: value.checkOut.slice(0, 10),
    adults: value.adults,
    children: value.children,
    pricePerNight: Number(value.pricePerNight),
    notes: value.notes ?? '',
  });
  folioPanel.value?.load();
}

async function load() {
  try {
    fill((await api.get<Reservation>(`/reservations/${route.params.id}`)).data);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function save() {
  if (!reservation.value) {
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const { data } = await api.patch<Reservation>(`/reservations/${reservation.value.id}`, {
      ...(checkedIn.value ? {} : { checkIn: edit.checkIn }),
      checkOut: edit.checkOut,
      adults: edit.adults,
      children: edit.children,
      pricePerNight: edit.pricePerNight,
      notes: edit.notes,
    });
    fill(data);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section v-if="reservation" class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <RouterLink :to="{ name: 'reservations' }" class="text-sm text-indigo-600 hover:underline">&larr; Reservas</RouterLink>
        <h1 class="flex items-center gap-3 text-2xl font-semibold">
          Reserva {{ reservation.code }}
          <StatusBadge :status="reservation.status" />
        </h1>
      </div>
      <ReservationActions :reservation="reservation" @updated="fill" @error="error = $event" />
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="card space-y-1 text-sm">
        <h2 class="mb-2 font-semibold">Hospede</h2>
        <p class="font-medium">{{ reservation.guest.firstName }} {{ reservation.guest.lastName }}</p>
        <p v-if="reservation.guest.email">{{ reservation.guest.email }}</p>
        <p v-if="reservation.guest.phone">{{ reservation.guest.phone }}</p>
      </div>
      <div class="card space-y-1 text-sm">
        <h2 class="mb-2 font-semibold">Estadia</h2>
        <p>Quarto {{ reservation.room.number }} · {{ reservation.room.type }}</p>
        <p>{{ formatDate(reservation.checkIn) }} → {{ formatDate(reservation.checkOut) }}</p>
        <p>{{ reservation.adults }} adultos · {{ reservation.children }} criancas</p>
        <p>Origem: {{ RESERVATION_SOURCE_LABELS[reservation.source] }}</p>
      </div>
      <div class="card space-y-1 text-sm">
        <h2 class="mb-2 font-semibold">Valores</h2>
        <p>{{ formatMoney(reservation.pricePerNight, hotels.currency) }} / noite</p>
        <p class="text-xl font-semibold">{{ formatMoney(reservation.totalAmount, hotels.currency) }}</p>
        <p v-if="reservation.depositPaymentId" class="text-emerald-700">
          Sinal pago {{ formatMoney(reservation.depositAmount ?? 0, hotels.currency) }} · restante
          {{ formatMoney(Number(reservation.totalAmount) - Number(reservation.depositAmount ?? 0), hotels.currency) }}
        </p>
      </div>
    </div>

    <DepositPanel :reservation="reservation" @updated="fill" />

    <FolioPanel ref="folioPanel" :reservation="reservation" />

    <form v-if="editable" class="card grid gap-3 sm:grid-cols-5" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-5">Alterar reserva</h2>
      <label class="text-sm">
        Entrada
        <input v-model="edit.checkIn" class="input" type="date" :disabled="checkedIn" required />
      </label>
      <label class="text-sm">
        Saida
        <input v-model="edit.checkOut" class="input" type="date" :min="addDays(edit.checkIn, 1)" required />
      </label>
      <label class="text-sm">
        Adultos
        <input v-model.number="edit.adults" class="input" type="number" min="1" max="20" />
      </label>
      <label class="text-sm">
        Criancas
        <input v-model.number="edit.children" class="input" type="number" min="0" max="20" />
      </label>
      <label class="text-sm">
        Preco/noite
        <input v-model.number="edit.pricePerNight" class="input" type="number" min="0" step="0.01" />
      </label>
      <textarea v-model="edit.notes" class="input sm:col-span-5" rows="2" placeholder="Notas" />
      <div class="flex justify-end sm:col-span-5">
        <button class="btn" type="submit" :disabled="saving">Guardar alteracoes</button>
      </div>
    </form>
    <p v-else-if="reservation.notes" class="card text-sm">{{ reservation.notes }}</p>
  </section>
  <p v-else-if="error" class="text-sm text-rose-600">{{ error }}</p>
</template>

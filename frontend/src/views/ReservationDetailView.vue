<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import CompanionsPanel from '@/components/CompanionsPanel.vue';
import DepositPanel from '@/components/DepositPanel.vue';
import FolioPanel from '@/components/FolioPanel.vue';
import ReservationActions from '@/components/ReservationActions.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Reservation } from '@/types';
import { addDays, formatDate, formatMoney, RESERVATION_SOURCE_LABELS } from '@/utils/format';

const { t } = useI18n();
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
    <PageHeader section="reservations">
      <template #title>
        {{ t('reservationDetail.title', { code: reservation.code }) }}
        <StatusBadge :status="reservation.status" />
      </template>
      <template #subtitle>
        <RouterLink :to="{ name: 'reservations' }" class="hover:underline">&larr; {{ t('nav.reservations') }}</RouterLink>
        · {{ reservation.guest.firstName }} {{ reservation.guest.lastName }} · {{ t('dashboard.room', { number: reservation.room.number }) }}
      </template>
      <ReservationActions :reservation="reservation" @updated="fill" @error="error = $event" />
    </PageHeader>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="card space-y-1 text-sm">
        <h2 class="mb-2 font-semibold">{{ t('reservations.guest') }}</h2>
        <p class="font-medium">{{ reservation.guest.firstName }} {{ reservation.guest.lastName }}</p>
        <p v-if="reservation.guest.email">{{ reservation.guest.email }}</p>
        <p v-if="reservation.guest.phone">{{ reservation.guest.phone }}</p>
        <p v-if="reservation.guest.documentNumber">{{ reservation.guest.documentType }} {{ reservation.guest.documentNumber }}</p>
        <p v-else class="text-amber-700">{{ t('reservationDetail.noDocument') }}</p>
        <p v-if="reservation.guest.nationality || reservation.guest.birthDate" class="text-slate-500">
          {{ [reservation.guest.nationality, reservation.guest.birthDate ? t('reservationDetail.born', { date: formatDate(reservation.guest.birthDate) }) : ''].filter(Boolean).join(' · ') }}
        </p>
        <RouterLink :to="{ name: 'guests', query: { id: reservation.guest.id } }" class="text-xs text-indigo-600 hover:underline">{{ t('reservationDetail.editGuest') }}</RouterLink>
      </div>
      <div class="card space-y-1 text-sm">
        <h2 class="mb-2 font-semibold">{{ t('reservationDetail.stay') }}</h2>
        <p>{{ t('dashboard.room', { number: reservation.room.number }) }} · {{ reservation.room.type }}</p>
        <p>{{ formatDate(reservation.checkIn) }} → {{ formatDate(reservation.checkOut) }}</p>
        <p>{{ t('reservationDetail.occupants', { adults: reservation.adults, children: reservation.children }) }}</p>
        <p>{{ t('reservations.sourceFilter', { source: RESERVATION_SOURCE_LABELS[reservation.source] }) }}</p>
      </div>
      <div class="card space-y-1 text-sm">
        <h2 class="mb-2 font-semibold">{{ t('reservationDetail.amounts') }}</h2>
        <p>{{ formatMoney(reservation.pricePerNight, hotels.currency) }} {{ t('site.perNight') }}</p>
        <p class="text-xl font-semibold">{{ formatMoney(reservation.totalAmount, hotels.currency) }}</p>
        <p v-if="reservation.depositPaymentId" class="text-emerald-700">
          {{ t('reservationDetail.depositPaid', { amount: formatMoney(reservation.depositAmount ?? 0, hotels.currency), remaining: formatMoney(Number(reservation.totalAmount) - Number(reservation.depositAmount ?? 0), hotels.currency) }) }}
        </p>
      </div>
    </div>

    <CompanionsPanel :reservation="reservation" @updated="fill" />

    <DepositPanel :reservation="reservation" @updated="fill" />

    <FolioPanel ref="folioPanel" :reservation="reservation" />

    <form v-if="editable" class="card grid gap-3 sm:grid-cols-5" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-5">{{ t('reservationDetail.change') }}</h2>
      <label class="text-sm">
        {{ t('newReservation.checkIn') }}
        <input v-model="edit.checkIn" class="input" type="date" :disabled="checkedIn" required />
      </label>
      <label class="text-sm">
        {{ t('newReservation.checkOut') }}
        <input v-model="edit.checkOut" class="input" type="date" :min="addDays(edit.checkIn, 1)" required />
      </label>
      <label class="text-sm">
        {{ t('newReservation.adults') }}
        <input v-model.number="edit.adults" class="input" type="number" min="1" max="20" />
      </label>
      <label class="text-sm">
        {{ t('newReservation.children') }}
        <input v-model.number="edit.children" class="input" type="number" min="0" max="20" />
      </label>
      <label class="text-sm">
        {{ t('reservationDetail.pricePerNight') }}
        <input v-model.number="edit.pricePerNight" class="input" type="number" min="0" step="0.01" />
      </label>
      <textarea v-model="edit.notes" class="input sm:col-span-5" rows="2" :placeholder="t('common.notes')" />
      <div class="flex justify-end sm:col-span-5">
        <button class="btn" type="submit" :disabled="saving">{{ t('reservationDetail.save') }}</button>
      </div>
    </form>
    <p v-else-if="reservation.notes" class="card text-sm">{{ reservation.notes }}</p>
  </section>
  <p v-else-if="error" class="text-sm text-rose-600">{{ error }}</p>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import GuestForm from '@/components/GuestForm.vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Guest, Reservation, ReservationSource, Room } from '@/types';
import { addDays, formatMoney, RESERVATION_SOURCE_LABELS, todayIso } from '@/utils/format';

const props = defineProps<{ initialCheckIn?: string; initialRoomId?: number }>();
const emit = defineEmits<{ created: [reservation: Reservation]; cancel: [] }>();

const { t } = useI18n();
const hotels = useHotelsStore();
const error = ref('');
const saving = ref(false);
const searching = ref(false);

const form = reactive({
  checkIn: props.initialCheckIn ?? todayIso(),
  checkOut: addDays(props.initialCheckIn ?? todayIso(), 1),
  adults: 2,
  children: 0,
  source: 'DESK' as ReservationSource,
  roomId: props.initialRoomId ?? 0,
  notes: '',
});

const guestQuery = ref('');
const guestResults = ref<Guest[]>([]);
const guest = ref<Guest | null>(null);
const creatingGuest = ref(false);
const rooms = ref<Room[] | null>(null);

const nights = computed(() => {
  const diff = (new Date(form.checkOut).getTime() - new Date(form.checkIn).getTime()) / 86_400_000;
  return Number.isFinite(diff) ? Math.round(diff) : 0;
});

let guestTimer: ReturnType<typeof setTimeout> | undefined;

function searchGuests() {
  clearTimeout(guestTimer);
  guestTimer = setTimeout(async () => {
    if (guestQuery.value.trim().length < 2) {
      guestResults.value = [];
      return;
    }
    guestResults.value = (
      await api.get<Guest[]>('/guests', { params: { hotelId: hotels.selectedId, q: guestQuery.value } })
    ).data.slice(0, 8);
  }, 250);
}

function pickGuest(selected: Guest) {
  guest.value = selected;
  guestResults.value = [];
  guestQuery.value = '';
  creatingGuest.value = false;
}

function onCheckInChange() {
  if (form.checkOut <= form.checkIn) {
    form.checkOut = addDays(form.checkIn, 1);
  }
  rooms.value = null;
}

async function findRooms() {
  searching.value = true;
  error.value = '';
  try {
    rooms.value = (
      await api.get<Room[]>('/reservations/availability', {
        params: {
          hotelId: hotels.selectedId,
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          guests: form.adults + form.children,
        },
      })
    ).data;
    if (!rooms.value.some((room) => room.id === form.roomId)) {
      form.roomId = rooms.value[0]?.id ?? 0;
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    searching.value = false;
  }
}

async function submit() {
  if (!guest.value) {
    error.value = t('newReservation.pickGuest');
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const { data } = await api.post<Reservation>('/reservations', {
      guestId: guest.value.id,
      roomId: form.roomId,
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      adults: form.adults,
      children: form.children,
      source: form.source,
      notes: form.notes || undefined,
    });
    emit('created', data);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-5">
    <div class="space-y-2">
      <h3 class="text-sm font-semibold text-slate-600">{{ t('newReservation.step1') }}</h3>
      <div v-if="guest" class="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span>
          <span class="font-medium">{{ guest.firstName }} {{ guest.lastName }}</span>
          <span class="text-slate-500"> · {{ guest.email ?? guest.phone ?? t('newReservation.noContact') }}</span>
        </span>
        <button class="text-indigo-600 hover:underline" type="button" @click="guest = null">{{ t('newReservation.change') }}</button>
      </div>
      <template v-else>
        <div class="relative flex gap-2">
          <input v-model="guestQuery" class="input" :placeholder="t('newReservation.searchGuest')" @input="searchGuests" />
          <button class="btn-secondary whitespace-nowrap" type="button" @click="creatingGuest = !creatingGuest">
            {{ t('newReservation.newGuest') }}
          </button>
          <ul
            v-if="guestResults.length"
            class="absolute top-full z-10 mt-1 w-full rounded-md border border-slate-200 bg-white text-sm shadow"
          >
            <li v-for="result in guestResults" :key="result.id">
              <button class="w-full px-3 py-2 text-left hover:bg-slate-50" type="button" @click="pickGuest(result)">
                {{ result.firstName }} {{ result.lastName }}
                <span class="text-slate-500">{{ result.email ?? result.phone ?? '' }}</span>
              </button>
            </li>
          </ul>
        </div>
        <div v-if="creatingGuest" class="rounded-md border border-slate-200 p-3">
          <GuestForm @saved="pickGuest" @cancel="creatingGuest = false" />
        </div>
      </template>
    </div>

    <div class="space-y-2">
      <h3 class="text-sm font-semibold text-slate-600">{{ t('newReservation.step2') }}</h3>
      <div class="grid gap-3 sm:grid-cols-5">
        <label class="text-sm">
          {{ t('newReservation.checkIn') }}
          <input v-model="form.checkIn" class="input" type="date" :min="todayIso()" required @change="onCheckInChange" />
        </label>
        <label class="text-sm">
          {{ t('newReservation.checkOut') }}
          <input v-model="form.checkOut" class="input" type="date" :min="addDays(form.checkIn, 1)" required @change="rooms = null" />
        </label>
        <label class="text-sm">
          {{ t('newReservation.adults') }}
          <input v-model.number="form.adults" class="input" type="number" min="1" max="20" @change="rooms = null" />
        </label>
        <label class="text-sm">
          {{ t('newReservation.children') }}
          <input v-model.number="form.children" class="input" type="number" min="0" max="20" @change="rooms = null" />
        </label>
        <label class="text-sm">
          {{ t('newReservation.source') }}
          <select v-model="form.source" class="input">
            <option v-for="(label, source) in RESERVATION_SOURCE_LABELS" :key="source" :value="source">{{ label }}</option>
          </select>
        </label>
      </div>
      <button class="btn-secondary" type="button" :disabled="searching || nights < 1" @click="findRooms">
        {{ t('newReservation.findRooms', { nights: t('newReservation.nights', nights) }) }}
      </button>
    </div>

    <div v-if="rooms" class="space-y-2">
      <h3 class="text-sm font-semibold text-slate-600">{{ t('newReservation.step3') }}</h3>
      <p v-if="!rooms.length" class="text-sm text-slate-500">{{ t('newReservation.noRooms') }}</p>
      <div class="grid gap-2 sm:grid-cols-3">
        <label
          v-for="room in rooms"
          :key="room.id"
          class="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
          :class="form.roomId === room.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'"
        >
          <input v-model="form.roomId" type="radio" :value="room.id" />
          <span>
            <span class="font-medium">{{ room.number }}</span> · {{ room.type }} · {{ room.capacity }}p
            <span class="block text-slate-500">
              {{ t('newReservation.roomPrice', { night: formatMoney(room.pricePerNight, hotels.currency), total: formatMoney(Number(room.pricePerNight) * nights, hotels.currency) }) }}
            </span>
          </span>
        </label>
      </div>
      <textarea v-model="form.notes" class="input" rows="2" :placeholder="t('newReservation.notes')" />
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="flex justify-end gap-2">
      <button class="btn-secondary" type="button" @click="emit('cancel')">{{ t('common.close') }}</button>
      <button class="btn" type="button" :disabled="saving || !rooms?.length || !form.roomId || !guest" @click="submit">
        {{ t('newReservation.create') }}
      </button>
    </div>
  </div>
</template>

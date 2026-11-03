<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import GuestForm from '@/components/GuestForm.vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import { DOCUMENT_TYPES, type BookingKind, type Guest, type Reservation, type ReservationGroup, type ReservationSource, type Room } from '@/types';
import { addDays, formatMoney, RESERVATION_SOURCE_LABELS, todayIso } from '@/utils/format';

interface Occupant {
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  nationality: string;
}

interface Selection {
  adults: number;
  children: number;
  separate: boolean;
  occupant: Occupant;
}

const props = defineProps<{ initialCheckIn?: string; initialRoomId?: number }>();
const emit = defineEmits<{ created: [reservation: Reservation]; cancel: [] }>();

const { t } = useI18n();
const hotels = useHotelsStore();
const error = ref('');
const saving = ref(false);
const searching = ref(false);

const kind = ref<BookingKind>('INDIVIDUAL');
const corporate = computed(() => kind.value === 'CORPORATE');
const company = reactive({ name: '', taxId: '', address: '', email: '', phone: '', contactName: '' });

const form = reactive({
  checkIn: props.initialCheckIn ?? todayIso(),
  checkOut: addDays(props.initialCheckIn ?? todayIso(), 1),
  adults: 2,
  children: 0,
  source: 'DESK' as ReservationSource,
  notes: '',
});

const guestQuery = ref('');
const guestResults = ref<Guest[]>([]);
const guest = ref<Guest | null>(null);
const creatingGuest = ref(false);
const rooms = ref<Room[] | null>(null);
const selected = reactive<Record<number, Selection>>({});

const nights = computed(() => {
  const diff = (new Date(form.checkOut).getTime() - new Date(form.checkIn).getTime()) / 86_400_000;
  return Number.isFinite(diff) ? Math.round(diff) : 0;
});
const chosenRooms = computed(() => (rooms.value ?? []).filter((room) => selected[room.id]));
const assignedAdults = computed(() => chosenRooms.value.reduce((total, room) => total + selected[room.id].adults, 0));
const assignedChildren = computed(() => chosenRooms.value.reduce((total, room) => total + selected[room.id].children, 0));
const chosenCapacity = computed(() => chosenRooms.value.reduce((total, room) => total + room.capacity, 0));
const total = computed(() => chosenRooms.value.reduce((sum, room) => sum + Number(room.pricePerNight) * nights.value, 0));
const roomsValid = computed(
  () =>
    chosenRooms.value.length > 0 &&
    chosenRooms.value.every((room) => {
      const choice = selected[room.id];
      const occupantOk = !(corporate.value || choice.separate) || (choice.occupant.firstName.trim() && choice.occupant.lastName.trim() && (!corporate.value || choice.occupant.documentNumber.trim()));
      return choice.adults >= 1 && choice.children >= 0 && choice.adults + choice.children <= room.capacity && occupantOk;
    }),
);
const ready = computed(() => roomsValid.value && (corporate.value ? company.name.trim() && company.taxId.trim().length >= 5 : !!guest.value));

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

function pickGuest(chosen: Guest) {
  guest.value = chosen;
  guestResults.value = [];
  guestQuery.value = '';
  creatingGuest.value = false;
}

async function lookupCompany() {
  const taxId = company.taxId.trim();
  if (taxId.length < 5) return;
  try {
    const { data } = await api.get<Partial<Record<'companyName' | 'companyAddress' | 'companyEmail' | 'companyPhone' | 'contactName', string | null>>>('/reservation-groups/company', {
      params: { taxId, hotelId: hotels.selectedId },
    });
    company.name ||= data.companyName ?? '';
    company.address ||= data.companyAddress ?? '';
    company.email ||= data.companyEmail ?? '';
    company.phone ||= data.companyPhone ?? '';
    company.contactName ||= data.contactName ?? '';
  } catch {
    return;
  }
}

function resetRooms() {
  rooms.value = null;
  for (const key of Object.keys(selected)) delete selected[Number(key)];
}

function onCheckInChange() {
  if (form.checkOut <= form.checkIn) {
    form.checkOut = addDays(form.checkIn, 1);
  }
  resetRooms();
}

function toggleRoom(room: Room) {
  if (selected[room.id]) {
    delete selected[room.id];
    return;
  }
  const adults = Math.max(Math.min(form.adults - assignedAdults.value, room.capacity), 1);
  const children = Math.max(Math.min(form.children - assignedChildren.value, room.capacity - adults), 0);
  selected[room.id] = { adults, children, separate: false, occupant: { firstName: '', lastName: '', documentType: 'BI', documentNumber: '', nationality: '' } };
}

async function findRooms() {
  searching.value = true;
  error.value = '';
  try {
    rooms.value = (
      await api.get<Room[]>('/reservations/availability', {
        params: { hotelId: hotels.selectedId, checkIn: form.checkIn, checkOut: form.checkOut },
      })
    ).data;
    for (const key of Object.keys(selected)) {
      if (!rooms.value.some((room) => room.id === Number(key))) delete selected[Number(key)];
    }
    const initial = rooms.value.find((room) => room.id === props.initialRoomId);
    if (initial && !selected[initial.id]) toggleRoom(initial);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    searching.value = false;
  }
}

function occupantPayload(occupant: Occupant) {
  return {
    firstName: occupant.firstName.trim(),
    lastName: occupant.lastName.trim(),
    documentType: occupant.documentNumber.trim() ? occupant.documentType : undefined,
    documentNumber: occupant.documentNumber.trim() || undefined,
    nationality: occupant.nationality.trim() || undefined,
  };
}

async function submit() {
  if (!ready.value) {
    error.value = corporate.value ? t('newReservation.companyRequired') : t('newReservation.pickGuest');
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const single = !corporate.value && chosenRooms.value.length === 1 && !selected[chosenRooms.value[0].id].separate;
    if (single) {
      const room = chosenRooms.value[0];
      const { data } = await api.post<Reservation>('/reservations', {
        guestId: guest.value!.id,
        roomId: room.id,
        checkIn: form.checkIn,
        checkOut: form.checkOut,
        adults: selected[room.id].adults,
        children: selected[room.id].children,
        source: form.source,
        notes: form.notes || undefined,
      });
      emit('created', data);
      return;
    }
    const { data } = await api.post<ReservationGroup>('/reservation-groups', {
      kind: kind.value,
      hotelId: hotels.selectedId ?? undefined,
      guestId: corporate.value ? undefined : guest.value!.id,
      company: corporate.value
        ? {
            name: company.name.trim(),
            taxId: company.taxId.trim(),
            address: company.address.trim() || undefined,
            email: company.email.trim() || undefined,
            phone: company.phone.trim() || undefined,
            contactName: company.contactName.trim() || undefined,
          }
        : undefined,
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      source: form.source,
      notes: form.notes || undefined,
      rooms: chosenRooms.value.map((room) => {
        const choice = selected[room.id];
        return {
          roomId: room.id,
          adults: choice.adults,
          children: choice.children,
          occupant: corporate.value || choice.separate ? occupantPayload(choice.occupant) : undefined,
        };
      }),
    });
    emit('created', data.reservations[0]);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center gap-2 text-sm" role="radiogroup" :aria-label="t('newReservation.kind')">
      <span class="font-semibold text-slate-600">{{ t('newReservation.kind') }}</span>
      <button
        v-for="option in (['INDIVIDUAL', 'CORPORATE'] as const)"
        :key="option"
        type="button"
        role="radio"
        :aria-checked="kind === option"
        class="rounded-full px-3 py-1 font-medium ring-1"
        :class="kind === option ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'"
        @click="kind = option"
      >
        {{ option === 'INDIVIDUAL' ? t('newReservation.individual') : t('newReservation.corporate') }}
      </button>
    </div>

    <div v-if="corporate" class="space-y-2">
      <h3 class="text-sm font-semibold text-slate-600">{{ t('newReservation.step1Company') }}</h3>
      <div class="grid gap-3 sm:grid-cols-3">
        <input v-model="company.taxId" class="input" :placeholder="t('newReservation.companyTaxId')" maxlength="30" @blur="lookupCompany" />
        <input v-model="company.name" class="input sm:col-span-2" :placeholder="t('newReservation.companyName')" maxlength="200" />
        <input v-model="company.address" class="input sm:col-span-3" :placeholder="t('newReservation.companyAddress')" maxlength="255" />
        <input v-model="company.contactName" class="input" :placeholder="t('newReservation.contactName')" maxlength="150" />
        <input v-model="company.email" class="input" type="email" :placeholder="t('newReservation.companyEmail')" maxlength="150" />
        <input v-model="company.phone" class="input" :placeholder="t('newReservation.companyPhone')" maxlength="30" />
      </div>
      <p class="text-xs text-slate-500">{{ t('newReservation.companyHint') }}</p>
    </div>

    <div v-else class="space-y-2">
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
          <input v-model="form.checkOut" class="input" type="date" :min="addDays(form.checkIn, 1)" required @change="resetRooms" />
        </label>
        <label class="text-sm">
          {{ t('newReservation.adults') }}
          <input v-model.number="form.adults" class="input" type="number" min="1" max="200" />
        </label>
        <label class="text-sm">
          {{ t('newReservation.children') }}
          <input v-model.number="form.children" class="input" type="number" min="0" max="200" />
        </label>
        <label class="text-sm">
          {{ t('newReservation.source') }}
          <select v-model="form.source" class="input">
            <option v-for="(label, value) in RESERVATION_SOURCE_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
      </div>
      <button class="btn-secondary" type="button" :disabled="searching || nights < 1" @click="findRooms">
        {{ t('newReservation.findRooms', { nights: t('newReservation.nights', nights) }) }}
      </button>
    </div>

    <div v-if="rooms" class="space-y-3">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-sm font-semibold text-slate-600">{{ t('newReservation.step3') }}</h3>
        <p class="text-xs" :class="chosenCapacity >= form.adults + form.children ? 'text-emerald-700' : 'text-amber-700'">
          {{ t('newReservation.capacity', { rooms: chosenRooms.length, capacity: chosenCapacity, guests: form.adults + form.children }) }}
        </p>
      </div>
      <p v-if="!rooms.length" class="text-sm text-slate-500">{{ t('newReservation.noRooms') }}</p>
      <div class="grid gap-2 sm:grid-cols-3">
        <label
          v-for="room in rooms"
          :key="room.id"
          class="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
          :class="selected[room.id] ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'"
        >
          <input type="checkbox" :checked="!!selected[room.id]" @change="toggleRoom(room)" />
          <span>
            <span class="font-medium">{{ room.number }}</span> · {{ room.type }} · {{ room.capacity }}p
            <span class="block text-slate-500">
              {{ t('newReservation.roomPrice', { night: formatMoney(room.pricePerNight, hotels.currency), total: formatMoney(Number(room.pricePerNight) * nights, hotels.currency) }) }}
            </span>
          </span>
        </label>
      </div>

      <div v-if="chosenRooms.length" class="space-y-2">
        <div v-for="room in chosenRooms" :key="room.id" class="space-y-2 rounded-md border border-slate-200 p-3">
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <span class="font-medium">{{ t('newReservation.roomLine', { number: room.number, type: room.type, capacity: room.capacity }) }}</span>
            <label class="flex items-center gap-1">
              {{ t('newReservation.adults') }}
              <input v-model.number="selected[room.id].adults" class="input w-16 py-1" type="number" min="1" :max="room.capacity" />
            </label>
            <label class="flex items-center gap-1">
              {{ t('newReservation.children') }}
              <input v-model.number="selected[room.id].children" class="input w-16 py-1" type="number" min="0" :max="room.capacity - 1" />
            </label>
            <span v-if="selected[room.id].adults + selected[room.id].children > room.capacity" class="text-xs text-rose-600">{{ t('newReservation.overCapacity') }}</span>
            <label v-if="!corporate" class="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
              <input v-model="selected[room.id].separate" type="checkbox" />
              {{ t('newReservation.otherGuest') }}
            </label>
          </div>
          <div v-if="corporate || selected[room.id].separate" class="grid gap-2 sm:grid-cols-5">
            <input v-model="selected[room.id].occupant.firstName" class="input" :placeholder="corporate ? t('newReservation.employeeFirstName') : t('newReservation.firstName')" maxlength="100" />
            <input v-model="selected[room.id].occupant.lastName" class="input" :placeholder="t('newReservation.lastName')" maxlength="100" />
            <select v-model="selected[room.id].occupant.documentType" class="input" :aria-label="t('newReservation.documentType')">
              <option v-for="type in DOCUMENT_TYPES" :key="type" :value="type">{{ type }}</option>
            </select>
            <input v-model="selected[room.id].occupant.documentNumber" class="input" :placeholder="corporate ? t('newReservation.documentRequired') : t('newReservation.documentNumber')" maxlength="50" />
            <input v-model="selected[room.id].occupant.nationality" class="input" :placeholder="t('newReservation.nationality')" maxlength="60" />
          </div>
        </div>
        <p v-if="assignedAdults !== form.adults || assignedChildren !== form.children" class="text-xs text-amber-700">
          {{ t('newReservation.assigned', { adults: assignedAdults, children: assignedChildren, wantedAdults: form.adults, wantedChildren: form.children }) }}
        </p>
        <p class="text-sm font-semibold">{{ t('newReservation.total', { total: formatMoney(total, hotels.currency) }) }}</p>
      </div>
      <textarea v-model="form.notes" class="input" rows="2" :placeholder="t('newReservation.notes')" />
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="flex justify-end gap-2">
      <button class="btn-secondary" type="button" @click="emit('cancel')">{{ t('common.close') }}</button>
      <button class="btn" type="button" :disabled="saving || !ready" @click="submit">
        {{ chosenRooms.length > 1 ? t('newReservation.createMany', { n: chosenRooms.length }) : t('newReservation.create') }}
      </button>
    </div>
  </div>
</template>

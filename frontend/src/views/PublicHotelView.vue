<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { locale } from '@/i18n';
import { api, errorMessage } from '@/services/api';
import { setPageIdentity } from '@/services/favicon';
import { fileUrl } from '@/services/files';
import { DOCUMENT_TYPES, type BookingKind, type PublicHotel, type PublicRoomType } from '@/types';
import { addDays, formatDate, formatMoney, todayIso } from '@/utils/format';

interface BookingResult {
  code: string;
  checkIn: string;
  checkOut: string;
  roomType: string;
  totalAmount: string;
  depositAmount: string | null;
  depositReference: string | null;
  currency: string;
  companyName?: string | null;
  rooms?: { code: string; roomType: string; adults: number; children: number; guestName: string; totalAmount: string }[];
}

const CARD_ACCENTS = ['from-indigo-500 to-violet-500', 'from-amber-400 to-orange-500', 'from-emerald-400 to-teal-500', 'from-pink-500 to-rose-500', 'from-sky-400 to-blue-500'];
const { t } = useI18n();
const STEPS = computed(() => [0, 1, 2, 3].map((index) => t(`site.steps.${index}`)));

const route = useRoute();
const slug = computed(() => encodeURIComponent(String(route.params.slug)));
const hotel = ref<PublicHotel | null>(null);
const error = ref('');
const loading = ref(false);

const search = reactive({ checkIn: addDays(todayIso(), 1), checkOut: addDays(todayIso(), 3), adults: 2, children: 0 });
const kind = ref<BookingKind>('INDIVIDUAL');
const corporate = computed(() => kind.value === 'CORPORATE');
const company = reactive({ name: '', taxId: '', address: '', email: '' });
const results = ref<PublicRoomType[] | null>(null);
const cart = reactive<Record<string, number>>({});
const proceeding = ref(false);
const guest = reactive({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  notes: '',
  birthDate: '',
  nationality: '',
  documentType: 'BI',
  documentNumber: '',
  taxId: '',
  address: '',
  depositPaymentTypeId: 0,
  depositReference: '',
});

interface CompanionForm {
  firstName: string;
  lastName: string;
  isChild: boolean;
  birthDate: string;
  nationality: string;
  documentType: string;
  documentNumber: string;
}
interface Occupant {
  firstName: string;
  lastName: string;
  birthDate: string;
  nationality: string;
  documentType: string;
  documentNumber: string;
}

interface RoomSlot {
  type: string;
  capacity: number;
  adults: number;
  children: number;
  separate: boolean;
  occupant: Occupant;
  companions: CompanionForm[];
}

const slots = ref<RoomSlot[]>([]);
const guestsTotal = computed(() => search.adults + search.children);
const cartRooms = computed(() => (results.value ?? []).flatMap((room) => Array.from({ length: cart[room.type] ?? 0 }, () => room)));
const cartCapacity = computed(() => cartRooms.value.reduce((total, room) => total + room.capacity, 0));
const cartTotal = computed(() => cartRooms.value.reduce((total, room) => total + Number(room.total ?? 0), 0));
const cartDeposit = computed(() => cartRooms.value.reduce((total, room) => total + Number(room.deposit ?? 0), 0));
const cartLines = computed(() => (results.value ?? []).filter((room) => cart[room.type]).map((room) => ({ room, count: cart[room.type], total: cart[room.type] * Number(room.total ?? 0) })));
const freeCapacity = computed(() => (results.value ?? []).reduce((total, room) => total + room.capacity * room.available, 0));
const cartProblem = computed(() => {
  if (!cartRooms.value.length) return freeCapacity.value < guestsTotal.value ? t('site.cart.impossible', { n: guestsTotal.value }) : t('site.cart.empty');
  if (cartCapacity.value < guestsTotal.value) return t('site.cart.short', { n: guestsTotal.value - cartCapacity.value });
  if (cartRooms.value.length > search.adults) return t('site.cart.tooMany');
  return '';
});
const slotsValid = computed(
  () =>
    slots.value.reduce((total, slot) => total + slot.adults, 0) === search.adults &&
    slots.value.reduce((total, slot) => total + slot.children, 0) === search.children &&
    slots.value.every((slot) => slot.adults >= 1 && slot.children >= 0 && slot.adults + slot.children <= slot.capacity),
);

function emptyOccupant(): Occupant {
  return { firstName: '', lastName: '', birthDate: '', nationality: '', documentType: 'BI', documentNumber: '' };
}

function setQuantity(room: PublicRoomType, delta: number) {
  cart[room.type] = Math.min(Math.max((cart[room.type] ?? 0) + delta, 0), room.available);
}

function suggestRooms() {
  for (const key of Object.keys(cart)) delete cart[key];
  const list = results.value ?? [];
  const single = list.filter((room) => room.capacity >= guestsTotal.value).sort((a, b) => Number(a.total) - Number(b.total))[0];
  if (single) {
    cart[single.type] = 1;
    return;
  }
  const left: Record<string, number> = Object.fromEntries(list.map((room) => [room.type, room.available]));
  const bySize = [...list].sort((a, b) => b.capacity - a.capacity || Number(a.total) - Number(b.total));
  let remaining = guestsTotal.value;
  while (remaining > 0) {
    const free = bySize.filter((room) => left[room.type] > 0);
    if (!free.length) break;
    const pick = [...free].reverse().find((room) => room.capacity >= remaining) ?? free[0];
    cart[pick.type] = (cart[pick.type] ?? 0) + 1;
    left[pick.type]--;
    remaining -= pick.capacity;
  }
}

function buildSlots() {
  const list = cartRooms.value.map((room) => ({ type: room.type, capacity: room.capacity, adults: 1, children: 0, separate: false, occupant: emptyOccupant(), companions: [] as CompanionForm[] }));
  let adults = search.adults - list.length;
  let children = search.children;
  for (const slot of list) {
    const add = Math.min(adults, slot.capacity - slot.adults);
    slot.adults += add;
    adults -= add;
  }
  for (const slot of list) {
    const add = Math.min(children, slot.capacity - slot.adults);
    slot.children += add;
    children -= add;
  }
  slots.value = list;
}

const maxCompanions = (slot: RoomSlot) => Math.max(slot.adults + slot.children - 1, 0);
const childCompanions = (slot: RoomSlot) => slot.companions.filter((companion) => companion.isChild).length;

function addCompanion(slot: RoomSlot) {
  if (slot.companions.length >= maxCompanions(slot)) return;
  slot.companions.push({
    firstName: '',
    lastName: corporate.value ? '' : guest.lastName,
    isChild: childCompanions(slot) < slot.children && slot.companions.length >= slot.adults - 1,
    birthDate: '',
    nationality: corporate.value ? '' : guest.nationality,
    documentType: 'BI',
    documentNumber: '',
  });
}

watch(
  slots,
  (list) => {
    for (const slot of list) {
      if (slot.companions.length > maxCompanions(slot)) slot.companions.splice(maxCompanions(slot));
    }
  },
  { deep: true },
);
const booking = ref<BookingResult | null>(null);
const photo = reactive<Record<string, number>>({});
const viewer = ref<{ images: string[]; index: number } | null>(null);
const bookingForm = ref<HTMLElement | null>(null);
const roomsSection = ref<HTMLElement | null>(null);

const needsDeposit = computed(() => (hotel.value?.depositPercent ?? 0) > 0);
const money = (value: string | number) => formatMoney(value, hotel.value?.currency ?? 'EUR');
const remaining = computed(() => cartTotal.value - cartDeposit.value);
const heroImage = computed(() => hotel.value?.roomTypes.find((room) => room.images.length)?.images[0] ?? null);
const nights = computed(() => Math.max(Math.round((Date.parse(search.checkOut) - Date.parse(search.checkIn)) / 86_400_000), 0));
const step = computed(() => (booking.value ? 3 : proceeding.value ? 2 : results.value ? 1 : 0));
const lowestPrice = computed(() => Math.min(...(hotel.value?.roomTypes.map((room) => Number(room.pricePerNight)) ?? [0])));
const place = computed(() => [hotel.value?.address, hotel.value?.city].filter(Boolean).join(', '));
const mapsUrl = computed(() => (place.value ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hotel.value?.name} ${place.value}`)}` : ''));
const rooms = computed(() => results.value ?? hotel.value?.roomTypes ?? []);
const english = computed(() => locale.value === 'en');
const description = computed(() => (english.value && hotel.value?.publicDescriptionEn) || hotel.value?.publicDescription || '');
const instructions = computed(() => (english.value && hotel.value?.paymentInstructionsEn) || hotel.value?.paymentInstructions || '');
const roomDescription = (room: PublicRoomType) => (english.value && room.descriptionEn) || room.description;

watch(
  slug,
  async () => {
    hotel.value = null;
    error.value = '';
    try {
      hotel.value = (await api.get<PublicHotel>(`/public/hotels/${slug.value}`)).data;
      guest.depositPaymentTypeId = hotel.value.paymentTypes[0]?.id ?? 0;
      setPageIdentity(hotel.value.name, hotel.value.logoFile ? fileUrl(hotel.value.logoFile) : null);
    } catch (e) {
      error.value = errorMessage(e);
    }
  },
  { immediate: true },
);

function onCheckInChange() {
  if (search.checkOut <= search.checkIn) {
    search.checkOut = addDays(search.checkIn, 1);
  }
}

function currentPhoto(room: PublicRoomType) {
  return room.images[photo[room.type] ?? 0] ?? room.images[0];
}

function stepPhoto(room: PublicRoomType, delta: number) {
  photo[room.type] = ((photo[room.type] ?? 0) + delta + room.images.length) % room.images.length;
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function proceed() {
  if (cartProblem.value) return;
  buildSlots();
  proceeding.value = true;
  await nextTick();
  bookingForm.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function findAvailability() {
  loading.value = true;
  error.value = '';
  proceeding.value = false;
  try {
    results.value = (
      await api.get<PublicRoomType[]>(`/public/hotels/${slug.value}/availability`, {
        params: { checkIn: search.checkIn, checkOut: search.checkOut },
      })
    ).data;
    suggestRooms();
    await nextTick();
    roomsSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function newSearch() {
  slots.value = [];
  results.value = null;
  proceeding.value = false;
  booking.value = null;
  for (const key of Object.keys(cart)) delete cart[key];
  scrollToId('reservar');
}

function occupantPayload(occupant: Occupant) {
  return {
    firstName: occupant.firstName.trim(),
    lastName: occupant.lastName.trim(),
    birthDate: occupant.birthDate || undefined,
    nationality: occupant.nationality.trim() || undefined,
    documentType: occupant.documentType,
    documentNumber: occupant.documentNumber.trim() || undefined,
  };
}

async function book() {
  if (!proceeding.value || !slotsValid.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    booking.value = (
      await api.post<BookingResult>(`/public/hotels/${slug.value}/reservations`, {
        checkIn: search.checkIn,
        checkOut: search.checkOut,
        kind: kind.value,
        company: corporate.value
          ? { name: company.name.trim(), taxId: company.taxId.trim(), address: company.address.trim() || undefined, email: company.email.trim() || undefined }
          : undefined,
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email,
        phone: guest.phone || undefined,
        notes: guest.notes || undefined,
        ...(corporate.value
          ? {}
          : {
              birthDate: guest.birthDate || undefined,
              nationality: guest.nationality.trim() || undefined,
              documentType: guest.documentType,
              documentNumber: guest.documentNumber.trim(),
              taxId: guest.taxId.trim() || undefined,
              address: guest.address.trim() || undefined,
            }),
        rooms: slots.value.map((slot, index) => ({
          roomType: slot.type,
          adults: slot.adults,
          children: slot.children,
          occupant: corporate.value || (index > 0 && slot.separate) ? occupantPayload(slot.occupant) : undefined,
          companions: slot.companions.map((companion) => ({
            firstName: companion.firstName.trim(),
            lastName: companion.lastName.trim(),
            isChild: companion.isChild,
            birthDate: companion.birthDate || undefined,
            nationality: companion.nationality.trim() || undefined,
            documentType: companion.documentNumber.trim() ? companion.documentType : undefined,
            documentNumber: companion.documentNumber.trim() || undefined,
          })),
        })),
        depositPaymentTypeId: needsDeposit.value && guest.depositPaymentTypeId ? guest.depositPaymentTypeId : undefined,
        depositReference: needsDeposit.value ? guest.depositReference.trim() : undefined,
        locale: locale.value,
      })
    ).data;
    await nextTick();
    scrollToId('reservar');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-full bg-gradient-to-b from-amber-50/60 via-white to-indigo-50/60 text-slate-800">
    <p v-if="error && !hotel" class="py-20 text-center text-slate-500">{{ error }}</p>

    <template v-if="hotel">
      <nav class="sticky top-0 z-30 border-b border-white/40 bg-white/80 backdrop-blur">
        <div class="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <button type="button" class="flex min-w-0 items-center gap-3" @click="scrollToId('inicio')">
            <img v-if="hotel.logoFile" :src="fileUrl(hotel.logoFile)" :alt="hotel.name" class="h-9 max-w-28 object-contain" />
            <span class="truncate font-semibold">{{ hotel.name }}</span>
          </button>
          <div class="ml-auto hidden items-center gap-5 text-sm text-slate-600 sm:flex">
            <button type="button" class="hover:text-indigo-700" @click="scrollToId('quartos')">{{ t('site.nav.rooms') }}</button>
            <button type="button" class="hover:text-indigo-700" @click="scrollToId('como-reservar')">{{ t('site.nav.howTo') }}</button>
            <button type="button" class="hover:text-indigo-700" @click="scrollToId('contactos')">{{ t('site.nav.contacts') }}</button>
          </div>
          <button type="button" class="ml-auto rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-1.5 text-sm font-semibold text-white shadow hover:brightness-105 sm:ml-0" @click="scrollToId('reservar')">
            {{ t('site.nav.book') }}
          </button>
          <LanguageSwitcher />
        </div>
      </nav>

      <header id="inicio" class="relative isolate overflow-hidden">
        <img v-if="heroImage" :src="fileUrl(heroImage)" alt="" class="absolute inset-0 -z-20 h-full w-full object-cover" />
        <div class="absolute inset-0 -z-10" :class="heroImage ? 'bg-gradient-to-br from-indigo-950/85 via-violet-900/70 to-orange-700/50' : 'bg-gradient-to-br from-indigo-700 via-violet-600 to-orange-500'" />
        <div class="absolute -top-20 -left-20 -z-10 size-56 rounded-full bg-amber-300/30 blur-3xl" />
        <div class="absolute -right-16 -bottom-10 -z-10 size-64 rounded-full bg-fuchsia-400/25 blur-3xl" />
        <div class="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-x-8 gap-y-3 px-4 pt-8 pb-24 text-white sm:pt-10">
          <div class="min-w-0 max-w-2xl">
            <p v-if="place" class="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs backdrop-blur">
              <svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>
              {{ place }}
            </p>
            <h1 class="text-3xl font-bold tracking-tight drop-shadow sm:text-4xl">{{ hotel.name }}</h1>
            <p v-if="description" class="mt-2 text-sm leading-relaxed text-white/85 line-clamp-2 sm:text-base">{{ description }}</p>
          </div>
          <p v-if="hotel.roomTypes.length" class="shrink-0 rounded-xl bg-white/15 px-4 py-2 text-sm text-white/90 backdrop-blur">
            {{ t('site.roomsFrom') }} <span class="block text-2xl leading-tight font-bold text-amber-300">{{ money(lowestPrice) }}<span class="text-sm font-normal text-white/80"> {{ t('site.perNight') }}</span></span>
          </p>
        </div>
      </header>

      <main class="mx-auto -mt-16 max-w-6xl space-y-16 px-4 pb-16">
        <div class="relative z-10 space-y-6">
        <section id="como-reservar" class="scroll-mt-20" aria-labelledby="como-reservar-titulo">
          <h2 id="como-reservar-titulo" class="sr-only">{{ t('site.nav.howTo') }}</h2>
          <ol class="grid gap-3 md:grid-cols-3">
            <li
              v-for="(item, index) in [
                { title: t('site.how.chooseTitle'), text: t('site.how.chooseText'), color: 'from-indigo-500 to-violet-500' },
                needsDeposit
                  ? { title: t('site.how.depositTitle', { percent: hotel.depositPercent }), text: t('site.how.depositText'), color: 'from-amber-400 to-orange-500' }
                  : { title: t('site.how.sendTitle'), text: t('site.how.sendText'), color: 'from-amber-400 to-orange-500' },
                { title: t('site.how.confirmTitle'), text: needsDeposit ? t('site.how.confirmDeposit') : t('site.how.confirmPlain'), color: 'from-emerald-400 to-teal-500' },
              ]"
              :key="item.title"
              class="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-lg ring-1 shadow-indigo-900/10 ring-slate-100"
            >
              <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-lg font-bold text-white shadow" :class="item.color">{{ index + 1 }}</span>
              <span>
                <span class="block font-semibold text-slate-900">{{ item.title }}</span>
                <span class="block text-sm text-slate-600">{{ item.text }}</span>
              </span>
            </li>
          </ol>
        </section>

        <section id="reservar" class="relative z-10 scroll-mt-20 rounded-2xl bg-white p-5 shadow-xl ring-1 shadow-indigo-900/10 ring-slate-100 sm:p-6">
          <ol class="mb-5 flex flex-wrap gap-2 text-xs font-medium">
            <li
              v-for="(label, index) in STEPS"
              :key="label"
              class="flex items-center gap-2 rounded-full px-3 py-1"
              :class="index === step ? 'bg-indigo-600 text-white' : index < step ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'"
            >
              <span class="flex size-5 items-center justify-center rounded-full" :class="index === step ? 'bg-white/25' : index < step ? 'bg-emerald-500 text-white' : 'bg-white'">
                {{ index < step ? '✓' : index + 1 }}
              </span>
              {{ label }}
            </li>
          </ol>

          <div v-if="booking" class="space-y-4 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 p-5 ring-1 ring-emerald-200">
            <div class="flex items-center gap-3">
              <span class="flex size-11 items-center justify-center rounded-full bg-emerald-500 text-xl text-white shadow">✓</span>
              <div>
                <h2 class="text-xl font-semibold text-emerald-900">{{ t('site.done.title') }}</h2>
                <p class="text-sm text-emerald-800">{{ t('site.done.code') }} <span class="font-mono font-bold">{{ booking.code }}</span></p>
              </div>
            </div>
            <dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <template v-if="booking.companyName">
                <dt class="text-slate-500">{{ t('site.done.company') }}</dt>
                <dd>{{ booking.companyName }}</dd>
              </template>
              <dt class="text-slate-500">{{ booking.rooms && booking.rooms.length > 1 ? t('site.done.rooms') : t('site.done.room') }}</dt>
              <dd>
                <template v-if="booking.rooms?.length">
                  <span v-for="room in booking.rooms" :key="room.code" class="block">{{ room.roomType }} · {{ room.guestName }} <span class="font-mono text-xs text-slate-500">{{ room.code }}</span></span>
                </template>
                <template v-else>{{ booking.roomType }}</template>
              </dd>
              <dt class="text-slate-500">{{ t('site.done.dates') }}</dt>
              <dd>{{ t('site.done.datesValue', { from: formatDate(booking.checkIn), to: formatDate(booking.checkOut) }) }}</dd>
              <dt class="text-slate-500">{{ t('site.done.total') }}</dt>
              <dd class="font-semibold">{{ formatMoney(booking.totalAmount, booking.currency) }}</dd>
              <template v-if="booking.depositAmount">
                <dt class="text-slate-500">{{ t('site.done.deposit') }}</dt>
                <dd>{{ t('site.done.depositValue', { amount: formatMoney(booking.depositAmount, booking.currency), reference: booking.depositReference }) }}</dd>
                <dt class="text-slate-500">{{ t('site.done.remaining') }}</dt>
                <dd>{{ t('site.done.remainingValue', { amount: formatMoney(Number(booking.totalAmount) - Number(booking.depositAmount), booking.currency) }) }}</dd>
              </template>
            </dl>
            <p class="text-sm text-slate-700">
              {{ booking.depositAmount ? t('site.done.depositNext') : t('site.done.plainNext') }}
              {{ t('site.done.keepCode') }}
            </p>
            <button type="button" class="text-sm font-medium text-emerald-800 hover:underline" @click="newSearch">{{ t('site.done.another') }}</button>
          </div>

          <form v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.7fr_0.7fr_auto]" @submit.prevent="findAvailability">
            <div class="flex flex-wrap items-center gap-2 text-sm sm:col-span-2 lg:col-span-5" role="radiogroup" :aria-label="t('site.search.kind')">
              <span class="font-medium text-slate-600">{{ t('site.search.kind') }}</span>
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
                {{ option === 'INDIVIDUAL' ? t('site.search.individual') : t('site.search.corporate') }}
              </button>
            </div>
            <label class="text-sm font-medium text-slate-600">
              {{ t('site.search.checkIn') }}
              <input v-model="search.checkIn" class="input mt-1" type="date" :min="todayIso()" required @change="onCheckInChange" />
            </label>
            <label class="text-sm font-medium text-slate-600">
              {{ t('site.search.checkOut') }}
              <input v-model="search.checkOut" class="input mt-1" type="date" :min="addDays(search.checkIn, 1)" required />
            </label>
            <label class="text-sm font-medium text-slate-600">
              {{ t('site.search.adults') }}
              <input v-model.number="search.adults" class="input mt-1" type="number" min="1" max="20" required />
            </label>
            <label class="text-sm font-medium text-slate-600">
              {{ t('site.search.children') }}
              <input v-model.number="search.children" class="input mt-1" type="number" min="0" max="20" />
            </label>
            <button
              class="self-end rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 font-semibold text-white shadow-md hover:brightness-110 disabled:opacity-60 sm:col-span-2 lg:col-span-1"
              type="submit"
              :disabled="loading"
            >
              {{ loading ? t('site.search.searching') : `${t('site.search.submit')}${nights ? ` · ${t('site.search.nights', nights)}` : ''}` }}
            </button>
          </form>
          <p v-if="error" class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
        </section>
        </div>

        <section v-if="!booking" id="quartos" ref="roomsSection" class="scroll-mt-20 space-y-6">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p class="text-sm font-semibold tracking-widest text-orange-500 uppercase">{{ results ? t('site.rooms.available') : t('site.rooms.ours') }}</p>
              <h2 class="text-3xl font-bold text-slate-900">
                {{ results ? t('site.rooms.range', { from: formatDate(search.checkIn), to: formatDate(search.checkOut) }) : t('site.rooms.choose') }}
              </h2>
            </div>
            <button v-if="results" type="button" class="text-sm font-medium text-indigo-700 hover:underline" @click="newSearch">{{ t('site.rooms.changeDates') }}</button>
          </div>

          <p v-if="results && !results.length" class="rounded-xl bg-amber-50 p-6 text-center text-amber-900 ring-1 ring-amber-200">
            {{ t('site.rooms.none') }}
          </p>

          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            <article
              v-for="(room, index) in rooms"
              :key="room.type"
              class="group flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:shadow-lg"
              :class="cart[room.type] ? 'ring-[3px] ring-indigo-500' : ''"
            >
              <div class="relative aspect-[4/3] overflow-hidden">
                <img
                  v-if="room.images.length"
                  :src="fileUrl(currentPhoto(room))"
                  :alt="room.type"
                  loading="lazy"
                  class="h-full w-full cursor-zoom-in object-cover transition duration-500 group-hover:scale-105"
                  @click="viewer = { images: room.images, index: photo[room.type] ?? 0 }"
                />
                <div v-else class="flex h-full items-center justify-center bg-gradient-to-br text-white" :class="CARD_ACCENTS[index % CARD_ACCENTS.length]">
                  <svg viewBox="0 0 24 24" class="size-10 opacity-80" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 18v-6a2 2 0 012-2h14a2 2 0 012 2v6M3 18h18M3 18v2M21 18v2M6 10V7a2 2 0 012-2h8a2 2 0 012 2v3" /></svg>
                </div>
                <span class="absolute top-1.5 left-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-800 shadow" :title="t('site.rooms.upTo', { n: room.capacity })">
                  &#128100; {{ room.capacity }}
                </span>
                <span v-if="results" class="absolute top-1.5 right-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow" :class="room.available <= 2 ? 'bg-rose-500' : 'bg-emerald-500'">
                  {{ room.available <= 2 ? t('site.rooms.only', { n: room.available }) : t('site.rooms.free', { n: room.available }) }}
                </span>
                <template v-if="room.images.length > 1">
                  <button class="absolute top-1/2 left-1 -translate-y-1/2 rounded-full bg-white/85 px-1.5 text-base opacity-0 shadow transition group-hover:opacity-100" type="button" :aria-label="t('site.rooms.prevPhoto')" @click="stepPhoto(room, -1)">‹</button>
                  <button class="absolute top-1/2 right-1 -translate-y-1/2 rounded-full bg-white/85 px-1.5 text-base opacity-0 shadow transition group-hover:opacity-100" type="button" :aria-label="t('site.rooms.nextPhoto')" @click="stepPhoto(room, 1)">›</button>
                  <div class="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-1">
                    <span v-for="(_, dot) in room.images" :key="dot" class="size-1 rounded-full" :class="dot === (photo[room.type] ?? 0) ? 'bg-white' : 'bg-white/50'" />
                  </div>
                </template>
              </div>
              <div class="flex flex-1 flex-col gap-1 p-2.5">
                <h3 class="truncate text-sm font-semibold text-slate-900" :title="room.type">{{ room.type }}</h3>
                <p v-if="roomDescription(room)" class="line-clamp-2 text-xs leading-snug text-slate-500" :title="roomDescription(room) ?? ''">{{ roomDescription(room) }}</p>
                <div class="mt-auto pt-1.5">
                  <template v-if="results">
                    <p class="text-base leading-tight font-bold text-indigo-700">{{ money(room.total ?? room.pricePerNight) }}</p>
                    <p class="truncate text-[11px] text-slate-500">
                      {{ t('site.search.nights', room.nights ?? 0) }}<template v-if="needsDeposit && room.deposit"> · {{ t('site.rooms.deposit', { amount: money(room.deposit) }) }}</template>
                    </p>
                  </template>
                  <p v-else class="text-base leading-tight font-bold text-indigo-700">
                    {{ money(room.pricePerNight) }}<span class="text-[11px] font-normal text-slate-500"> {{ t('site.perNightShort') }}</span>
                  </p>
                  <div v-if="results" class="mt-1.5 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      class="flex size-7 items-center justify-center rounded-lg bg-slate-100 font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                      :aria-label="t('site.cart.less')"
                      :disabled="!cart[room.type] || proceeding"
                      @click="setQuantity(room, -1)"
                    >
                      −
                    </button>
                    <span class="text-sm font-semibold" :class="cart[room.type] ? 'text-indigo-700' : 'text-slate-400'">{{ cart[room.type] ?? 0 }}</span>
                    <button
                      type="button"
                      class="flex size-7 items-center justify-center rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 font-bold text-white hover:brightness-105 disabled:opacity-40"
                      :aria-label="t('site.cart.more')"
                      :disabled="(cart[room.type] ?? 0) >= room.available || proceeding"
                      @click="setQuantity(room, 1)"
                    >
                      +
                    </button>
                  </div>
                  <button v-else type="button" class="mt-1.5 w-full rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" @click="scrollToId('reservar')">
                    {{ t('site.rooms.seeDates') }}
                  </button>
                </div>
              </div>
            </article>
          </div>

          <div v-if="results && results.length" class="sticky bottom-3 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-white/95 p-4 shadow-xl ring-1 ring-slate-200 backdrop-blur">
            <div class="min-w-0 flex-1 text-sm">
              <p class="font-semibold text-slate-900">
                {{ t('site.cart.title') }}:
                <template v-if="cartLines.length">{{ cartLines.map((line) => `${line.count} × ${line.room.type}`).join(', ') }}</template>
                <template v-else>—</template>
              </p>
              <p v-if="cartProblem" class="text-amber-700">{{ cartProblem }}</p>
              <p v-else class="text-slate-500">
                {{ t('site.cart.rooms', cartRooms.length) }} · {{ t('site.cart.capacity', { capacity: cartCapacity, guests: guestsTotal }) }} · <span class="font-semibold text-indigo-700">{{ money(cartTotal) }}</span>
              </p>
            </div>
            <button v-if="!proceeding" type="button" class="text-sm font-medium text-indigo-700 hover:underline" @click="suggestRooms">{{ t('site.cart.suggest') }}</button>
            <button
              v-if="!proceeding"
              type="button"
              class="rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2 text-sm font-semibold text-white shadow hover:brightness-110 disabled:opacity-50"
              :disabled="!!cartProblem"
              @click="proceed"
            >
              {{ t('site.cart.continue') }}
            </button>
          </div>
        </section>

        <section v-if="proceeding && !booking" ref="bookingForm" class="scroll-mt-20">
          <form class="grid gap-4 rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-100 lg:grid-cols-[1fr_340px]" @submit.prevent="book">
            <div class="grid content-start gap-3 sm:grid-cols-2">
              <h2 class="text-2xl font-bold text-slate-900 sm:col-span-2">{{ t('site.form.title') }}</h2>
              <template v-if="corporate">
                <h3 class="font-semibold text-slate-800 sm:col-span-2">{{ t('site.form.companyTitle') }}</h3>
                <input v-model="company.name" class="input" :placeholder="t('site.form.companyName')" maxlength="200" autocomplete="organization" required />
                <input v-model="company.taxId" class="input" :placeholder="t('site.form.companyTaxId')" minlength="5" maxlength="30" required />
                <input v-model="company.address" class="input" :placeholder="t('site.form.companyAddress')" maxlength="255" />
                <input v-model="company.email" class="input" type="email" :placeholder="t('site.form.companyEmail')" maxlength="150" />
                <h3 class="font-semibold text-slate-800 sm:col-span-2">{{ t('site.form.contactTitle') }}</h3>
              </template>
              <input v-model="guest.firstName" class="input" :placeholder="t('site.form.firstName')" autocomplete="given-name" required />
              <input v-model="guest.lastName" class="input" :placeholder="t('site.form.lastName')" autocomplete="family-name" required />
              <input v-model="guest.email" class="input" type="email" :placeholder="t('site.form.email')" autocomplete="email" required />
              <input v-model="guest.phone" class="input" :placeholder="t('site.form.phone')" autocomplete="tel" />
              <template v-if="!corporate">
              <label class="text-xs font-medium text-slate-600">
                {{ t('site.form.birthDate') }}
                <input v-model="guest.birthDate" class="input mt-1" type="date" :max="todayIso()" autocomplete="bday" />
              </label>
              <label class="text-xs font-medium text-slate-600">
                {{ t('site.form.nationality') }}
                <input v-model="guest.nationality" class="input mt-1" :placeholder="t('site.form.nationalityExample')" maxlength="60" autocomplete="country-name" />
              </label>
              <label class="text-xs font-medium text-slate-600">
                {{ t('site.form.document') }}
                <select v-model="guest.documentType" class="input mt-1" required>
                  <option v-for="type in DOCUMENT_TYPES" :key="type" :value="type">{{ type }}</option>
                </select>
              </label>
              <label class="text-xs font-medium text-slate-600">
                {{ t('site.form.documentNumber') }}
                <input v-model="guest.documentNumber" class="input mt-1" :placeholder="t('site.form.documentExample')" minlength="3" maxlength="50" required />
              </label>
              <input v-model="guest.taxId" class="input" :placeholder="t('site.form.taxId')" maxlength="30" />
              <input v-model="guest.address" class="input" :placeholder="t('site.form.address')" maxlength="255" autocomplete="street-address" />
              </template>

              <p v-if="corporate" class="text-xs text-slate-500 sm:col-span-2">{{ t('site.form.employeesHint') }}</p>
              <p v-if="!slotsValid" class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200 sm:col-span-2">
                {{ t('site.form.distribution', { adults: search.adults, children: search.children }) }}
              </p>

              <section v-for="(slot, slotIndex) in slots" :key="slotIndex" class="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100 sm:col-span-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h3 class="font-semibold text-slate-800">{{ t('site.form.roomTitle', { n: slotIndex + 1, type: slot.type }) }}</h3>
                  <span class="flex items-center gap-2 text-xs text-slate-600">
                    <label class="flex items-center gap-1">
                      {{ t('site.search.adults') }}
                      <input v-model.number="slot.adults" class="input w-16 py-1" type="number" min="1" :max="slot.capacity" required />
                    </label>
                    <label class="flex items-center gap-1">
                      {{ t('site.search.children') }}
                      <input v-model.number="slot.children" class="input w-16 py-1" type="number" min="0" :max="slot.capacity - 1" />
                    </label>
                    <span class="text-slate-400">&#128100; {{ slot.capacity }}</span>
                  </span>
                </div>

                <p v-if="!corporate && slotIndex === 0" class="text-xs text-slate-500">{{ t('site.form.titularHere') }}</p>
                <label v-if="!corporate && slotIndex > 0" class="flex items-center gap-2 text-sm text-slate-700">
                  <input v-model="slot.separate" type="checkbox" />
                  {{ slot.separate ? t('site.form.otherPerson') : t('site.form.titularHere') }}
                </label>
                <div v-if="corporate || (slotIndex > 0 && slot.separate)" class="grid gap-2 rounded-lg bg-white p-3 ring-1 ring-indigo-200 sm:grid-cols-4">
                  <span class="text-xs font-semibold text-indigo-700 sm:col-span-4">{{ corporate ? t('site.form.employee') : t('site.form.otherPerson') }}</span>
                  <input v-model="slot.occupant.firstName" class="input" :placeholder="t('site.form.firstName')" maxlength="100" required />
                  <input v-model="slot.occupant.lastName" class="input" :placeholder="t('site.form.lastName')" maxlength="100" required />
                  <input v-model="slot.occupant.birthDate" class="input" type="date" :max="todayIso()" :aria-label="t('site.form.birthDate')" :title="t('site.form.birthDate')" />
                  <input v-model="slot.occupant.nationality" class="input" :placeholder="t('site.form.nationality')" maxlength="60" />
                  <select v-model="slot.occupant.documentType" class="input sm:col-span-2" :aria-label="t('site.form.documentType')">
                    <option v-for="type in DOCUMENT_TYPES" :key="type" :value="type">{{ type }}</option>
                  </select>
                  <input v-model="slot.occupant.documentNumber" class="input sm:col-span-2" :placeholder="t('site.form.documentNo')" minlength="3" maxlength="50" :required="corporate" />
                </div>

                <template v-if="maxCompanions(slot) > 0">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h4 class="text-sm font-semibold text-slate-700">
                    {{ t('site.form.companions') }} <span class="text-xs font-normal text-slate-500">{{ t('site.form.companionsCount', { count: slot.companions.length, max: maxCompanions(slot) }) }}</span>
                  </h4>
                  <button v-if="slot.companions.length < maxCompanions(slot)" type="button" class="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" @click="addCompanion(slot)">
                    {{ t('site.form.addCompanion') }}
                  </button>
                </div>
                <p v-if="!slot.companions.length" class="text-xs text-slate-500">{{ t('site.form.companionsHint') }}</p>
                <div v-for="(companion, index) in slot.companions" :key="index" class="grid gap-2 rounded-lg bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-4">
                  <div class="flex items-center justify-between sm:col-span-4">
                    <span class="text-xs font-semibold text-slate-600">{{ t('site.form.companion', { n: index + 1 }) }}</span>
                    <span class="flex items-center gap-3">
                      <label class="flex items-center gap-1.5 text-xs text-slate-600" :class="!companion.isChild && childCompanions(slot) >= slot.children ? 'opacity-40' : ''">
                        <input v-model="companion.isChild" type="checkbox" :disabled="!companion.isChild && childCompanions(slot) >= slot.children" />
                        {{ t('site.form.child') }}
                      </label>
                      <button type="button" class="text-xs text-rose-600 hover:underline" @click="slot.companions.splice(index, 1)">{{ t('site.form.remove') }}</button>
                    </span>
                  </div>
                  <input v-model="companion.firstName" class="input" :placeholder="t('site.form.firstName')" maxlength="100" required />
                  <input v-model="companion.lastName" class="input" :placeholder="t('site.form.lastName')" maxlength="100" required />
                  <input v-model="companion.birthDate" class="input" type="date" :max="todayIso()" :aria-label="t('site.form.birthDate')" :title="t('site.form.birthDate')" />
                  <input v-model="companion.nationality" class="input" :placeholder="t('site.form.nationality')" maxlength="60" />
                  <select v-model="companion.documentType" class="input sm:col-span-2" :aria-label="t('site.form.documentType')">
                    <option v-for="type in DOCUMENT_TYPES" :key="type" :value="type">{{ type }}</option>
                  </select>
                  <input v-model="companion.documentNumber" class="input sm:col-span-2" :placeholder="companion.isChild ? t('site.form.documentIfAny') : t('site.form.documentNo')" maxlength="50" />
                </div>
                </template>
              </section>

              <textarea v-model="guest.notes" class="input sm:col-span-2" rows="2" :placeholder="t('site.form.notes')" />
              <p class="text-[11px] text-slate-500 sm:col-span-2">{{ t('site.form.privacy') }}</p>

              <section v-if="needsDeposit" class="space-y-3 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 p-4 ring-1 ring-amber-200 sm:col-span-2">
                <h3 class="font-semibold text-orange-900">{{ t('site.form.depositTitle', { percent: hotel.depositPercent }) }}</h3>
                <p v-if="instructions" class="rounded-lg bg-white p-3 text-sm whitespace-pre-line text-slate-700 shadow-sm">{{ instructions }}</p>
                <p v-else class="text-sm text-slate-600">{{ t('site.form.noInstructions') }}</p>
                <div class="grid gap-3 sm:grid-cols-2">
                  <label v-if="hotel.paymentTypes.length" class="text-sm font-medium text-slate-700">
                    {{ t('site.form.paidBy') }}
                    <select v-model.number="guest.depositPaymentTypeId" class="input mt-1">
                      <option v-for="type in hotel.paymentTypes" :key="type.id" :value="type.id">{{ type.name }}</option>
                    </select>
                  </label>
                  <label class="text-sm font-medium text-slate-700">
                    {{ t('site.form.reference') }}
                    <input v-model="guest.depositReference" class="input mt-1" maxlength="100" :placeholder="t('site.form.referencePlaceholder')" required />
                  </label>
                </div>
                <p class="text-xs text-orange-900/70">{{ t('site.form.depositNote') }}</p>
              </section>
            </div>

            <aside class="space-y-3 self-start rounded-xl bg-gradient-to-br from-indigo-600 to-violet-700 p-5 text-white shadow-lg">
              <p class="text-xs font-semibold tracking-widest text-indigo-200 uppercase">{{ t('site.summary.title') }}</p>
              <ul class="space-y-1">
                <li v-for="line in cartLines" :key="line.room.type" class="flex justify-between gap-2 text-sm">
                  <span class="font-semibold">{{ line.count }} × {{ line.room.type }}</span>
                  <span>{{ money(line.total) }}</span>
                </li>
              </ul>
              <img v-if="cartLines[0]?.room.images.length" :src="fileUrl(cartLines[0].room.images[0])" :alt="cartLines[0].room.type" class="aspect-video w-full rounded-lg object-cover" />
              <button type="button" class="text-xs font-medium text-indigo-100 underline hover:text-white" @click="proceeding = false">{{ t('site.cart.change') }}</button>
              <dl class="space-y-1 text-sm">
                <div class="flex justify-between"><dt class="text-indigo-200">{{ t('site.summary.checkIn') }}</dt><dd>{{ formatDate(search.checkIn) }}</dd></div>
                <div class="flex justify-between"><dt class="text-indigo-200">{{ t('site.summary.checkOut') }}</dt><dd>{{ formatDate(search.checkOut) }}</dd></div>
                <div class="flex justify-between"><dt class="text-indigo-200">{{ t('site.summary.guests') }}</dt><dd>{{ search.adults + search.children }}</dd></div>
                <div class="flex justify-between"><dt class="text-indigo-200">{{ t('site.summary.rooms') }}</dt><dd>{{ slots.length }}</dd></div>
                <div class="flex justify-between border-t border-white/20 pt-2 text-base font-semibold"><dt>{{ t('site.summary.total') }}</dt><dd>{{ money(cartTotal) }}</dd></div>
                <template v-if="needsDeposit">
                  <div class="flex justify-between text-amber-300"><dt>{{ t('site.summary.depositNow') }}</dt><dd class="font-semibold">{{ money(cartDeposit) }}</dd></div>
                  <div class="flex justify-between"><dt class="text-indigo-200">{{ t('site.summary.remaining') }}</dt><dd>{{ money(remaining) }}</dd></div>
                </template>
              </dl>
              <button class="w-full rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 font-semibold text-white shadow hover:brightness-105 disabled:opacity-60" type="submit" :disabled="loading || !slotsValid">
                {{ loading ? t('site.summary.sending') : needsDeposit ? t('site.summary.sendWithDeposit') : t('site.summary.request') }}
              </button>
            </aside>
          </form>
        </section>

      </main>

      <footer id="contactos" class="scroll-mt-20 bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-950 text-slate-200">
        <div class="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-3">
          <div class="space-y-3">
            <img v-if="hotel.logoFile" :src="fileUrl(hotel.logoFile)" :alt="hotel.name" class="max-h-14 max-w-40 rounded-lg bg-white p-1.5 object-contain" />
            <p class="text-xl font-semibold text-white">{{ hotel.name }}</p>
            <p v-if="description" class="text-sm text-slate-400 line-clamp-4">{{ description }}</p>
          </div>
          <div class="space-y-2 text-sm">
            <p class="font-semibold tracking-widest text-amber-300 uppercase">{{ t('site.footer.contacts') }}</p>
            <a v-if="hotel.phone" :href="`tel:${hotel.phone.replace(/\s/g, '')}`" class="block hover:text-white">{{ t('site.footer.phone', { value: hotel.phone }) }}</a>
            <a v-if="hotel.email" :href="`mailto:${hotel.email}`" class="block hover:text-white">{{ t('site.footer.email', { value: hotel.email }) }}</a>
            <a v-if="mapsUrl" :href="mapsUrl" target="_blank" rel="noopener" class="block hover:text-white">{{ t('site.footer.map', { place }) }}</a>
          </div>
          <div class="space-y-3 text-sm">
            <p class="font-semibold tracking-widest text-amber-300 uppercase">{{ t('site.footer.bookNow') }}</p>
            <p class="text-slate-400">{{ t('site.footer.direct') }}</p>
            <button type="button" class="rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2 font-semibold text-white shadow hover:brightness-105" @click="scrollToId('reservar')">
              {{ t('site.footer.availability') }}
            </button>
          </div>
        </div>
        <p class="border-t border-white/10 py-4 text-center text-xs text-slate-500">© {{ new Date().getFullYear() }} {{ hotel.name }}</p>
      </footer>

      <div v-if="viewer" class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" @click="viewer = null">
        <img :src="fileUrl(viewer.images[viewer.index])" alt="" class="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        <template v-if="viewer.images.length > 1">
          <button class="absolute top-1/2 left-4 -translate-y-1/2 rounded-full bg-white/85 px-3 py-1 text-2xl" type="button" :aria-label="t('site.rooms.prevPhoto')" @click.stop="viewer.index = (viewer.index - 1 + viewer.images.length) % viewer.images.length">‹</button>
          <button class="absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-white/85 px-3 py-1 text-2xl" type="button" :aria-label="t('site.rooms.nextPhoto')" @click.stop="viewer.index = (viewer.index + 1) % viewer.images.length">›</button>
        </template>
        <button class="absolute top-4 right-4 rounded bg-white/85 px-3 py-1 text-sm" type="button" @click="viewer = null">{{ t('common.close') }}</button>
      </div>
    </template>
  </div>
</template>

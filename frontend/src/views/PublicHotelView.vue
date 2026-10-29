<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '@/services/api';
import { fileUrl } from '@/services/files';
import type { PublicHotel, PublicRoomType } from '@/types';
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
}

const CARD_ACCENTS = ['from-indigo-500 to-violet-500', 'from-amber-400 to-orange-500', 'from-emerald-400 to-teal-500', 'from-pink-500 to-rose-500', 'from-sky-400 to-blue-500'];
const STEPS = ['Datas', 'Quarto', 'Os seus dados', 'Pedido enviado'];

const route = useRoute();
const slug = computed(() => encodeURIComponent(String(route.params.slug)));
const hotel = ref<PublicHotel | null>(null);
const error = ref('');
const loading = ref(false);

const search = reactive({ checkIn: addDays(todayIso(), 1), checkOut: addDays(todayIso(), 3), adults: 2, children: 0 });
const results = ref<PublicRoomType[] | null>(null);
const chosen = ref<PublicRoomType | null>(null);
const guest = reactive({ firstName: '', lastName: '', email: '', phone: '', notes: '', depositPaymentTypeId: 0, depositReference: '' });
const booking = ref<BookingResult | null>(null);
const photo = reactive<Record<string, number>>({});
const viewer = ref<{ images: string[]; index: number } | null>(null);
const bookingForm = ref<HTMLElement | null>(null);
const roomsSection = ref<HTMLElement | null>(null);

const needsDeposit = computed(() => (hotel.value?.depositPercent ?? 0) > 0);
const money = (value: string | number) => formatMoney(value, hotel.value?.currency ?? 'EUR');
const remaining = computed(() => (chosen.value?.total && chosen.value.deposit ? Number(chosen.value.total) - Number(chosen.value.deposit) : 0));
const heroImage = computed(() => hotel.value?.roomTypes.find((room) => room.images.length)?.images[0] ?? null);
const nights = computed(() => Math.max(Math.round((Date.parse(search.checkOut) - Date.parse(search.checkIn)) / 86_400_000), 0));
const step = computed(() => (booking.value ? 3 : chosen.value ? 2 : results.value ? 1 : 0));
const lowestPrice = computed(() => Math.min(...(hotel.value?.roomTypes.map((room) => Number(room.pricePerNight)) ?? [0])));
const place = computed(() => [hotel.value?.address, hotel.value?.city].filter(Boolean).join(', '));
const mapsUrl = computed(() => (place.value ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hotel.value?.name} ${place.value}`)}` : ''));
const rooms = computed(() => results.value ?? hotel.value?.roomTypes ?? []);

watch(
  slug,
  async () => {
    hotel.value = null;
    error.value = '';
    try {
      hotel.value = (await api.get<PublicHotel>(`/public/hotels/${slug.value}`)).data;
      guest.depositPaymentTypeId = hotel.value.paymentTypes[0]?.id ?? 0;
      document.title = hotel.value.name;
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

async function choose(room: PublicRoomType) {
  chosen.value = room;
  await nextTick();
  bookingForm.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function findAvailability() {
  loading.value = true;
  error.value = '';
  chosen.value = null;
  try {
    results.value = (
      await api.get<PublicRoomType[]>(`/public/hotels/${slug.value}/availability`, {
        params: { checkIn: search.checkIn, checkOut: search.checkOut, guests: search.adults + search.children },
      })
    ).data;
    await nextTick();
    roomsSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function newSearch() {
  results.value = null;
  chosen.value = null;
  booking.value = null;
  scrollToId('reservar');
}

async function book() {
  if (!chosen.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    booking.value = (
      await api.post<BookingResult>(`/public/hotels/${slug.value}/reservations`, {
        ...search,
        roomType: chosen.value.type,
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email,
        phone: guest.phone || undefined,
        notes: guest.notes || undefined,
        depositPaymentTypeId: needsDeposit.value && guest.depositPaymentTypeId ? guest.depositPaymentTypeId : undefined,
        depositReference: needsDeposit.value ? guest.depositReference.trim() : undefined,
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
            <button type="button" class="hover:text-indigo-700" @click="scrollToId('quartos')">Quartos</button>
            <button type="button" class="hover:text-indigo-700" @click="scrollToId('como-reservar')">Como reservar</button>
            <button type="button" class="hover:text-indigo-700" @click="scrollToId('contactos')">Contactos</button>
          </div>
          <button type="button" class="ml-auto rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-1.5 text-sm font-semibold text-white shadow hover:brightness-105 sm:ml-0" @click="scrollToId('reservar')">
            Reservar
          </button>
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
            <p v-if="hotel.publicDescription" class="mt-2 text-sm leading-relaxed text-white/85 line-clamp-2 sm:text-base">{{ hotel.publicDescription }}</p>
          </div>
          <p v-if="hotel.roomTypes.length" class="shrink-0 rounded-xl bg-white/15 px-4 py-2 text-sm text-white/90 backdrop-blur">
            Quartos desde <span class="block text-2xl leading-tight font-bold text-amber-300">{{ money(lowestPrice) }}<span class="text-sm font-normal text-white/80"> / noite</span></span>
          </p>
        </div>
      </header>

      <main class="mx-auto -mt-16 max-w-6xl space-y-16 px-4 pb-16">
        <div class="relative z-10 space-y-6">
        <section id="como-reservar" class="scroll-mt-20" aria-labelledby="como-reservar-titulo">
          <h2 id="como-reservar-titulo" class="sr-only">Como reservar</h2>
          <ol class="grid gap-3 md:grid-cols-3">
            <li
              v-for="(item, index) in [
                { title: 'Escolha datas e quarto', text: 'Veja a disponibilidade e o preco total da estadia.', color: 'from-indigo-500 to-violet-500' },
                needsDeposit
                  ? { title: `Pague o sinal de ${hotel.depositPercent}%`, text: 'Siga as instrucoes de pagamento e indique a referencia.', color: 'from-amber-400 to-orange-500' }
                  : { title: 'Envie o pedido', text: 'Basta o nome e o email. Nao paga nada agora.', color: 'from-amber-400 to-orange-500' },
                { title: 'Receba a confirmacao', text: needsDeposit ? 'Enviamos o comprovativo por email. O restante paga no hotel.' : 'Confirmamos a reserva por email.', color: 'from-emerald-400 to-teal-500' },
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
                <h2 class="text-xl font-semibold text-emerald-900">Pedido de reserva recebido</h2>
                <p class="text-sm text-emerald-800">Codigo <span class="font-mono font-bold">{{ booking.code }}</span></p>
              </div>
            </div>
            <dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt class="text-slate-500">Quarto</dt>
              <dd>{{ booking.roomType }}</dd>
              <dt class="text-slate-500">Datas</dt>
              <dd>{{ formatDate(booking.checkIn) }} a {{ formatDate(booking.checkOut) }}</dd>
              <dt class="text-slate-500">Total</dt>
              <dd class="font-semibold">{{ formatMoney(booking.totalAmount, booking.currency) }}</dd>
              <template v-if="booking.depositAmount">
                <dt class="text-slate-500">Sinal</dt>
                <dd>{{ formatMoney(booking.depositAmount, booking.currency) }} · referencia {{ booking.depositReference }}</dd>
                <dt class="text-slate-500">Restante</dt>
                <dd>{{ formatMoney(Number(booking.totalAmount) - Number(booking.depositAmount), booking.currency) }} no check-in ou check-out</dd>
              </template>
            </dl>
            <p class="text-sm text-slate-700">
              {{
                booking.depositAmount
                  ? 'Vamos verificar o pagamento do sinal e enviar-lhe por email o comprovativo e a confirmacao da reserva.'
                  : 'Vamos confirmar a reserva por email.'
              }}
              Guarde o codigo para qualquer contacto.
            </p>
            <button type="button" class="text-sm font-medium text-emerald-800 hover:underline" @click="newSearch">Fazer outra reserva</button>
          </div>

          <form v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.7fr_0.7fr_auto]" @submit.prevent="findAvailability">
            <label class="text-sm font-medium text-slate-600">
              Entrada
              <input v-model="search.checkIn" class="input mt-1" type="date" :min="todayIso()" required @change="onCheckInChange" />
            </label>
            <label class="text-sm font-medium text-slate-600">
              Saida
              <input v-model="search.checkOut" class="input mt-1" type="date" :min="addDays(search.checkIn, 1)" required />
            </label>
            <label class="text-sm font-medium text-slate-600">
              Adultos
              <input v-model.number="search.adults" class="input mt-1" type="number" min="1" max="20" required />
            </label>
            <label class="text-sm font-medium text-slate-600">
              Criancas
              <input v-model.number="search.children" class="input mt-1" type="number" min="0" max="20" />
            </label>
            <button
              class="self-end rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 font-semibold text-white shadow-md hover:brightness-110 disabled:opacity-60 sm:col-span-2 lg:col-span-1"
              type="submit"
              :disabled="loading"
            >
              {{ loading ? 'A procurar...' : `Ver disponibilidade${nights ? ` · ${nights} ${nights === 1 ? 'noite' : 'noites'}` : ''}` }}
            </button>
          </form>
          <p v-if="error" class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
        </section>
        </div>

        <section v-if="!booking" id="quartos" ref="roomsSection" class="scroll-mt-20 space-y-6">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p class="text-sm font-semibold tracking-widest text-orange-500 uppercase">{{ results ? 'Disponiveis para as suas datas' : 'Os nossos quartos' }}</p>
              <h2 class="text-3xl font-bold text-slate-900">
                {{ results ? `${formatDate(search.checkIn)} a ${formatDate(search.checkOut)}` : 'Escolha o seu espaco' }}
              </h2>
            </div>
            <button v-if="results" type="button" class="text-sm font-medium text-indigo-700 hover:underline" @click="newSearch">Mudar datas</button>
          </div>

          <p v-if="results && !results.length" class="rounded-xl bg-amber-50 p-6 text-center text-amber-900 ring-1 ring-amber-200">
            Sem disponibilidade para estas datas. Experimente outras datas ou contacte-nos.
          </p>

          <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <article
              v-for="(room, index) in rooms"
              :key="room.type"
              class="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-slate-100 transition hover:-translate-y-1 hover:shadow-xl"
              :class="chosen?.type === room.type ? 'ring-4 ring-indigo-500' : ''"
            >
              <div class="relative aspect-[4/3] overflow-hidden">
                <img
                  v-if="room.images.length"
                  :src="fileUrl(currentPhoto(room))"
                  :alt="room.type"
                  class="h-full w-full cursor-zoom-in object-cover transition duration-500 group-hover:scale-105"
                  @click="viewer = { images: room.images, index: photo[room.type] ?? 0 }"
                />
                <div v-else class="flex h-full items-center justify-center bg-gradient-to-br text-white" :class="CARD_ACCENTS[index % CARD_ACCENTS.length]">
                  <svg viewBox="0 0 24 24" class="size-16 opacity-80" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 18v-6a2 2 0 012-2h14a2 2 0 012 2v6M3 18h18M3 18v2M21 18v2M6 10V7a2 2 0 012-2h8a2 2 0 012 2v3" /></svg>
                </div>
                <span class="absolute top-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-800 shadow">
                  Ate {{ room.capacity }} {{ room.capacity === 1 ? 'pessoa' : 'pessoas' }}
                </span>
                <span v-if="results" class="absolute top-3 right-3 rounded-full px-3 py-1 text-xs font-semibold text-white shadow" :class="room.available <= 2 ? 'bg-rose-500' : 'bg-emerald-500'">
                  {{ room.available <= 2 ? `So ${room.available} disponive${room.available === 1 ? 'l' : 'is'}` : `${room.available} disponiveis` }}
                </span>
                <template v-if="room.images.length > 1">
                  <button class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/85 px-2.5 py-1 text-lg opacity-0 shadow transition group-hover:opacity-100" type="button" aria-label="Foto anterior" @click="stepPhoto(room, -1)">‹</button>
                  <button class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/85 px-2.5 py-1 text-lg opacity-0 shadow transition group-hover:opacity-100" type="button" aria-label="Foto seguinte" @click="stepPhoto(room, 1)">›</button>
                  <div class="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                    <span v-for="(_, dot) in room.images" :key="dot" class="size-1.5 rounded-full" :class="dot === (photo[room.type] ?? 0) ? 'bg-white' : 'bg-white/50'" />
                  </div>
                </template>
              </div>
              <div class="flex flex-1 flex-col gap-3 p-5">
                <h3 class="text-xl font-semibold text-slate-900">{{ room.type }}</h3>
                <p v-if="room.description" class="text-sm leading-relaxed whitespace-pre-line text-slate-600">{{ room.description }}</p>
                <div class="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
                  <div>
                    <template v-if="results">
                      <p class="text-2xl font-bold text-indigo-700">{{ money(room.total ?? room.pricePerNight) }}</p>
                      <p class="text-xs text-slate-500">
                        {{ room.nights }} {{ room.nights === 1 ? 'noite' : 'noites' }}
                        <template v-if="needsDeposit && room.deposit"> · sinal {{ money(room.deposit) }}</template>
                      </p>
                    </template>
                    <template v-else>
                      <p class="text-xs text-slate-500">desde</p>
                      <p class="text-2xl font-bold text-indigo-700">{{ money(room.pricePerNight) }}<span class="text-sm font-normal text-slate-500"> / noite</span></p>
                    </template>
                  </div>
                  <button
                    v-if="results"
                    type="button"
                    class="rounded-lg px-4 py-2 text-sm font-semibold shadow"
                    :class="chosen?.type === room.type ? 'bg-emerald-500 text-white' : 'bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:brightness-105'"
                    @click="choose(room)"
                  >
                    {{ chosen?.type === room.type ? 'Escolhido ✓' : 'Escolher' }}
                  </button>
                  <button v-else type="button" class="rounded-lg bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100" @click="scrollToId('reservar')">
                    Ver datas
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section v-if="chosen && !booking" ref="bookingForm" class="scroll-mt-20">
          <form class="grid gap-4 rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-100 lg:grid-cols-[1fr_340px]" @submit.prevent="book">
            <div class="grid content-start gap-3 sm:grid-cols-2">
              <h2 class="text-2xl font-bold text-slate-900 sm:col-span-2">Os seus dados</h2>
              <input v-model="guest.firstName" class="input" placeholder="Nome" autocomplete="given-name" required />
              <input v-model="guest.lastName" class="input" placeholder="Apelido" autocomplete="family-name" required />
              <input v-model="guest.email" class="input" type="email" placeholder="Email" autocomplete="email" required />
              <input v-model="guest.phone" class="input" placeholder="Telefone" autocomplete="tel" />
              <textarea v-model="guest.notes" class="input sm:col-span-2" rows="2" placeholder="Pedidos especiais (hora de chegada, cama extra...)" />

              <section v-if="needsDeposit" class="space-y-3 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 p-4 ring-1 ring-amber-200 sm:col-span-2">
                <h3 class="font-semibold text-orange-900">Pagamento do sinal ({{ hotel.depositPercent }}%)</h3>
                <p v-if="hotel.paymentInstructions" class="rounded-lg bg-white p-3 text-sm whitespace-pre-line text-slate-700 shadow-sm">{{ hotel.paymentInstructions }}</p>
                <p v-else class="text-sm text-slate-600">Contacte o hotel para obter os dados de pagamento.</p>
                <div class="grid gap-3 sm:grid-cols-2">
                  <label v-if="hotel.paymentTypes.length" class="text-sm font-medium text-slate-700">
                    Pagou por
                    <select v-model.number="guest.depositPaymentTypeId" class="input mt-1">
                      <option v-for="type in hotel.paymentTypes" :key="type.id" :value="type.id">{{ type.name }}</option>
                    </select>
                  </label>
                  <label class="text-sm font-medium text-slate-700">
                    Referencia do pagamento
                    <input v-model="guest.depositReference" class="input mt-1" maxlength="100" placeholder="Codigo da transacao" required />
                  </label>
                </div>
                <p class="text-xs text-orange-900/70">A reserva fica confirmada depois de verificarmos o pagamento do sinal.</p>
              </section>
            </div>

            <aside class="space-y-3 self-start rounded-xl bg-gradient-to-br from-indigo-600 to-violet-700 p-5 text-white shadow-lg">
              <p class="text-xs font-semibold tracking-widest text-indigo-200 uppercase">Resumo</p>
              <h3 class="text-xl font-semibold">{{ chosen.type }}</h3>
              <img v-if="chosen.images.length" :src="fileUrl(chosen.images[0])" :alt="chosen.type" class="aspect-video w-full rounded-lg object-cover" />
              <dl class="space-y-1 text-sm">
                <div class="flex justify-between"><dt class="text-indigo-200">Entrada</dt><dd>{{ formatDate(search.checkIn) }}</dd></div>
                <div class="flex justify-between"><dt class="text-indigo-200">Saida</dt><dd>{{ formatDate(search.checkOut) }}</dd></div>
                <div class="flex justify-between"><dt class="text-indigo-200">Hospedes</dt><dd>{{ search.adults + search.children }}</dd></div>
                <div class="flex justify-between border-t border-white/20 pt-2 text-base font-semibold"><dt>Total</dt><dd>{{ money(chosen.total ?? 0) }}</dd></div>
                <template v-if="needsDeposit">
                  <div class="flex justify-between text-amber-300"><dt>Sinal agora</dt><dd class="font-semibold">{{ money(chosen.deposit ?? 0) }}</dd></div>
                  <div class="flex justify-between"><dt class="text-indigo-200">Restante no hotel</dt><dd>{{ money(remaining) }}</dd></div>
                </template>
              </dl>
              <button class="w-full rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 font-semibold text-white shadow hover:brightness-105 disabled:opacity-60" type="submit" :disabled="loading">
                {{ loading ? 'A enviar...' : needsDeposit ? 'Enviar pedido com sinal' : 'Pedir reserva' }}
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
            <p v-if="hotel.publicDescription" class="text-sm text-slate-400 line-clamp-4">{{ hotel.publicDescription }}</p>
          </div>
          <div class="space-y-2 text-sm">
            <p class="font-semibold tracking-widest text-amber-300 uppercase">Contactos</p>
            <a v-if="hotel.phone" :href="`tel:${hotel.phone.replace(/\s/g, '')}`" class="block hover:text-white">Telefone: {{ hotel.phone }}</a>
            <a v-if="hotel.email" :href="`mailto:${hotel.email}`" class="block hover:text-white">Email: {{ hotel.email }}</a>
            <a v-if="mapsUrl" :href="mapsUrl" target="_blank" rel="noopener" class="block hover:text-white">{{ place }} · ver no mapa</a>
          </div>
          <div class="space-y-3 text-sm">
            <p class="font-semibold tracking-widest text-amber-300 uppercase">Reserve ja</p>
            <p class="text-slate-400">Reserva direta, sem intermediarios.</p>
            <button type="button" class="rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2 font-semibold text-white shadow hover:brightness-105" @click="scrollToId('reservar')">
              Ver disponibilidade
            </button>
          </div>
        </div>
        <p class="border-t border-white/10 py-4 text-center text-xs text-slate-500">© {{ new Date().getFullYear() }} {{ hotel.name }}</p>
      </footer>

      <div v-if="viewer" class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" @click="viewer = null">
        <img :src="fileUrl(viewer.images[viewer.index])" alt="" class="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        <template v-if="viewer.images.length > 1">
          <button class="absolute top-1/2 left-4 -translate-y-1/2 rounded-full bg-white/85 px-3 py-1 text-2xl" type="button" aria-label="Foto anterior" @click.stop="viewer.index = (viewer.index - 1 + viewer.images.length) % viewer.images.length">‹</button>
          <button class="absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-white/85 px-3 py-1 text-2xl" type="button" aria-label="Foto seguinte" @click.stop="viewer.index = (viewer.index + 1) % viewer.images.length">›</button>
        </template>
        <button class="absolute top-4 right-4 rounded bg-white/85 px-3 py-1 text-sm" type="button" @click="viewer = null">Fechar</button>
      </div>
    </template>
  </div>
</template>

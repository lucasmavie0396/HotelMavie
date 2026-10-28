<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '@/services/api';
import type { PublicHotel, PublicRoomType } from '@/types';
import { addDays, formatDate, formatMoney, todayIso } from '@/utils/format';

interface BookingResult {
  code: string;
  checkIn: string;
  checkOut: string;
  roomType: string;
  totalAmount: string;
  currency: string;
}

const route = useRoute();
const slug = computed(() => encodeURIComponent(String(route.params.slug)));
const hotel = ref<PublicHotel | null>(null);
const error = ref('');
const loading = ref(false);

const search = reactive({ checkIn: addDays(todayIso(), 1), checkOut: addDays(todayIso(), 3), adults: 2, children: 0 });
const results = ref<PublicRoomType[] | null>(null);
const chosen = ref<PublicRoomType | null>(null);
const guest = reactive({ firstName: '', lastName: '', email: '', phone: '', notes: '' });
const booking = ref<BookingResult | null>(null);

watch(
  slug,
  async () => {
    hotel.value = null;
    error.value = '';
    try {
      hotel.value = (await api.get<PublicHotel>(`/public/hotels/${slug.value}`)).data;
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
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
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
      })
    ).data;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-8 px-4 py-10">
    <p v-if="error && !hotel" class="text-center text-slate-500">{{ error }}</p>

    <template v-if="hotel">
      <header class="space-y-2">
        <h1 class="text-3xl font-semibold">{{ hotel.name }}</h1>
        <p class="text-sm text-slate-600">
          {{ [hotel.address, hotel.phone, hotel.email].filter(Boolean).join(' · ') }}
        </p>
      </header>

      <div v-if="booking" class="card space-y-2 border-emerald-200 bg-emerald-50">
        <h2 class="text-lg font-semibold text-emerald-800">Pedido de reserva recebido</h2>
        <p class="text-sm">
          Codigo <span class="font-mono font-semibold">{{ booking.code }}</span> · {{ booking.roomType }} ·
          {{ formatDate(booking.checkIn) }} a {{ formatDate(booking.checkOut) }} ·
          {{ formatMoney(booking.totalAmount, booking.currency) }}
        </p>
        <p class="text-sm text-slate-600">O hotel vai confirmar a reserva por email. Guarda o codigo para qualquer contacto.</p>
      </div>

      <template v-else>
        <form class="card grid gap-3 sm:grid-cols-5" @submit.prevent="findAvailability">
          <label class="text-sm">
            Entrada
            <input v-model="search.checkIn" class="input" type="date" :min="todayIso()" required @change="onCheckInChange" />
          </label>
          <label class="text-sm">
            Saida
            <input v-model="search.checkOut" class="input" type="date" :min="addDays(search.checkIn, 1)" required />
          </label>
          <label class="text-sm">
            Adultos
            <input v-model.number="search.adults" class="input" type="number" min="1" max="20" required />
          </label>
          <label class="text-sm">
            Criancas
            <input v-model.number="search.children" class="input" type="number" min="0" max="20" />
          </label>
          <button class="btn self-end" type="submit" :disabled="loading">Ver disponibilidade</button>
        </form>

        <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

        <div v-if="results" class="grid gap-4 sm:grid-cols-2">
          <p v-if="!results.length" class="text-sm text-slate-500 sm:col-span-2">Sem disponibilidade para estas datas.</p>
          <article
            v-for="room in results"
            :key="room.type"
            class="card cursor-pointer space-y-2"
            :class="chosen?.type === room.type ? 'ring-2 ring-indigo-500' : ''"
            @click="chosen = room"
          >
            <h2 class="font-semibold">{{ room.type }}</h2>
            <p class="text-sm text-slate-600">Ate {{ room.capacity }} pessoas · {{ room.available }} disponiveis</p>
            <p v-if="room.description" class="text-sm">{{ room.description }}</p>
            <p class="text-lg font-semibold">
              {{ formatMoney(room.total ?? room.pricePerNight, hotel.currency) }}
              <span class="text-sm font-normal text-slate-500">
                {{ room.nights }} {{ room.nights === 1 ? 'noite' : 'noites' }}
              </span>
            </p>
          </article>
        </div>

        <div v-else class="grid gap-4 sm:grid-cols-2">
          <article v-for="room in hotel.roomTypes" :key="room.type" class="card space-y-2">
            <h2 class="font-semibold">{{ room.type }}</h2>
            <p class="text-sm text-slate-600">Ate {{ room.capacity }} pessoas</p>
            <p v-if="room.description" class="text-sm">{{ room.description }}</p>
            <p class="text-lg font-semibold">
              desde {{ formatMoney(room.pricePerNight, hotel.currency) }}
              <span class="text-sm font-normal text-slate-500">/ noite</span>
            </p>
          </article>
        </div>

        <form v-if="chosen" class="card grid gap-3 sm:grid-cols-2" @submit.prevent="book">
          <h2 class="font-semibold sm:col-span-2">Os teus dados · {{ chosen.type }}</h2>
          <input v-model="guest.firstName" class="input" placeholder="Nome" required />
          <input v-model="guest.lastName" class="input" placeholder="Apelido" required />
          <input v-model="guest.email" class="input" type="email" placeholder="Email" required />
          <input v-model="guest.phone" class="input" placeholder="Telefone" />
          <textarea v-model="guest.notes" class="input sm:col-span-2" rows="2" placeholder="Pedidos especiais" />
          <button class="btn sm:col-span-2 sm:justify-self-end" type="submit" :disabled="loading">Pedir reserva</button>
        </form>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
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

const needsDeposit = computed(() => (hotel.value?.depositPercent ?? 0) > 0);
const money = (value: string | number) => formatMoney(value, hotel.value?.currency ?? 'EUR');
const remaining = computed(() => (chosen.value?.total && chosen.value.deposit ? Number(chosen.value.total) - Number(chosen.value.deposit) : 0));

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

function step(room: PublicRoomType, delta: number) {
  photo[room.type] = ((photo[room.type] ?? 0) + delta + room.images.length) % room.images.length;
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
        depositPaymentTypeId: needsDeposit.value && guest.depositPaymentTypeId ? guest.depositPaymentTypeId : undefined,
        depositReference: needsDeposit.value ? guest.depositReference.trim() : undefined,
      })
    ).data;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-full bg-slate-50">
    <p v-if="error && !hotel" class="py-20 text-center text-slate-500">{{ error }}</p>

    <template v-if="hotel">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-5xl flex-wrap items-center gap-5 px-4 py-6">
          <img v-if="hotel.logoFile" :src="fileUrl(hotel.logoFile)" :alt="hotel.name" class="max-h-20 max-w-48 object-contain" />
          <div class="min-w-0 flex-1">
            <h1 class="text-3xl font-semibold text-slate-900">{{ hotel.name }}</h1>
            <p class="mt-1 text-sm text-slate-600">
              {{ [hotel.address, hotel.city].filter(Boolean).join(', ') }}
            </p>
            <p class="text-sm text-slate-600">{{ [hotel.phone, hotel.email].filter(Boolean).join(' · ') }}</p>
          </div>
        </div>
      </header>

      <main class="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <p v-if="hotel.publicDescription && !booking" class="max-w-3xl text-base leading-relaxed whitespace-pre-line text-slate-700">
          {{ hotel.publicDescription }}
        </p>

        <div v-if="booking" class="card space-y-4 border-emerald-200 bg-emerald-50">
          <h2 class="text-xl font-semibold text-emerald-800">Pedido de reserva recebido</h2>
          <dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt class="text-slate-500">Codigo</dt>
            <dd class="font-mono font-semibold">{{ booking.code }}</dd>
            <dt class="text-slate-500">Quarto</dt>
            <dd>{{ booking.roomType }}</dd>
            <dt class="text-slate-500">Datas</dt>
            <dd>{{ formatDate(booking.checkIn) }} a {{ formatDate(booking.checkOut) }}</dd>
            <dt class="text-slate-500">Total</dt>
            <dd>{{ formatMoney(booking.totalAmount, booking.currency) }}</dd>
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
                ? 'O hotel vai verificar o pagamento do sinal e enviar-lhe por email o comprovativo e a confirmacao da reserva.'
                : 'O hotel vai confirmar a reserva por email.'
            }}
            Guarde o codigo para qualquer contacto.
          </p>
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

          <p v-if="results && !results.length" class="text-sm text-slate-500">Sem disponibilidade para estas datas.</p>
          <div class="grid gap-5 sm:grid-cols-2">
            <article
              v-for="room in results ?? hotel.roomTypes"
              :key="room.type"
              class="card overflow-hidden p-0"
              :class="[results ? 'cursor-pointer' : '', chosen?.type === room.type ? 'ring-2 ring-indigo-500' : '']"
              @click="results && (chosen = room)"
            >
              <div class="relative aspect-[4/3] bg-slate-200">
                <img
                  v-if="room.images.length"
                  :src="fileUrl(currentPhoto(room))"
                  :alt="room.type"
                  class="h-full w-full cursor-zoom-in object-cover"
                  @click.stop="viewer = { images: room.images, index: photo[room.type] ?? 0 }"
                />
                <div v-else class="flex h-full items-center justify-center text-sm text-slate-400">Sem fotografias</div>
                <template v-if="room.images.length > 1">
                  <button class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/85 px-2.5 py-1 text-lg shadow" type="button" aria-label="Foto anterior" @click.stop="step(room, -1)">‹</button>
                  <button class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/85 px-2.5 py-1 text-lg shadow" type="button" aria-label="Foto seguinte" @click.stop="step(room, 1)">›</button>
                  <span class="absolute right-2 bottom-2 rounded bg-black/50 px-1.5 text-xs text-white">{{ (photo[room.type] ?? 0) + 1 }}/{{ room.images.length }}</span>
                </template>
              </div>
              <div class="space-y-2 p-4">
                <h2 class="text-lg font-semibold">{{ room.type }}</h2>
                <p class="text-sm text-slate-600">
                  Ate {{ room.capacity }} pessoas<template v-if="results"> · {{ room.available }} disponiveis</template>
                </p>
                <p v-if="room.description" class="text-sm whitespace-pre-line">{{ room.description }}</p>
                <p v-if="results" class="text-lg font-semibold">
                  {{ money(room.total ?? room.pricePerNight) }}
                  <span class="text-sm font-normal text-slate-500">{{ room.nights }} {{ room.nights === 1 ? 'noite' : 'noites' }}</span>
                </p>
                <p v-else class="text-lg font-semibold">
                  desde {{ money(room.pricePerNight) }}
                  <span class="text-sm font-normal text-slate-500">/ noite</span>
                </p>
                <p v-if="results && needsDeposit && room.deposit" class="text-sm text-slate-600">
                  Sinal de {{ hotel.depositPercent }}%: <strong>{{ money(room.deposit) }}</strong>
                </p>
                <button v-if="results" class="btn w-full" type="button" @click.stop="chosen = room">
                  {{ chosen?.type === room.type ? 'Escolhido' : 'Escolher' }}
                </button>
              </div>
            </article>
          </div>

          <form v-if="chosen" class="card grid gap-3 sm:grid-cols-2" @submit.prevent="book">
            <h2 class="text-lg font-semibold sm:col-span-2">Os seus dados · {{ chosen.type }}</h2>
            <input v-model="guest.firstName" class="input" placeholder="Nome" required />
            <input v-model="guest.lastName" class="input" placeholder="Apelido" required />
            <input v-model="guest.email" class="input" type="email" placeholder="Email" required />
            <input v-model="guest.phone" class="input" placeholder="Telefone" />
            <textarea v-model="guest.notes" class="input sm:col-span-2" rows="2" placeholder="Pedidos especiais" />

            <section v-if="needsDeposit" class="space-y-3 rounded-md border border-indigo-100 bg-indigo-50/60 p-4 sm:col-span-2">
              <h3 class="font-semibold">Pagamento do sinal ({{ hotel.depositPercent }}%)</h3>
              <div class="grid gap-1 text-sm sm:grid-cols-3">
                <p>Total da estadia: <strong>{{ money(chosen.total ?? 0) }}</strong></p>
                <p>Sinal a pagar agora: <strong class="text-indigo-700">{{ money(chosen.deposit ?? 0) }}</strong></p>
                <p>Restante no hotel: <strong>{{ money(remaining) }}</strong></p>
              </div>
              <p v-if="hotel.paymentInstructions" class="rounded-md bg-white p-3 text-sm whitespace-pre-line text-slate-700">{{ hotel.paymentInstructions }}</p>
              <p v-else class="text-sm text-slate-600">Contacte o hotel para obter os dados de pagamento.</p>
              <div class="grid gap-3 sm:grid-cols-2">
                <label v-if="hotel.paymentTypes.length" class="text-sm">
                  Pagou por
                  <select v-model.number="guest.depositPaymentTypeId" class="input">
                    <option v-for="type in hotel.paymentTypes" :key="type.id" :value="type.id">{{ type.name }}</option>
                  </select>
                </label>
                <label class="text-sm">
                  Referencia do pagamento
                  <input v-model="guest.depositReference" class="input" maxlength="100" placeholder="Codigo da transacao ou n.o do comprovativo" required />
                </label>
              </div>
              <p class="text-xs text-slate-500">A reserva fica confirmada depois de o hotel verificar o pagamento do sinal.</p>
            </section>

            <button class="btn sm:col-span-2 sm:justify-self-end" type="submit" :disabled="loading">
              {{ needsDeposit ? 'Enviar pedido de reserva com sinal' : 'Pedir reserva' }}
            </button>
          </form>
        </template>
      </main>

      <div v-if="viewer" class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" @click="viewer = null">
        <img :src="fileUrl(viewer.images[viewer.index])" alt="" class="max-h-full max-w-full rounded object-contain" />
        <template v-if="viewer.images.length > 1">
          <button class="absolute top-1/2 left-4 -translate-y-1/2 rounded-full bg-white/85 px-3 py-1 text-2xl" type="button" aria-label="Foto anterior" @click.stop="viewer.index = (viewer.index - 1 + viewer.images.length) % viewer.images.length">‹</button>
          <button class="absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-white/85 px-3 py-1 text-2xl" type="button" aria-label="Foto seguinte" @click.stop="viewer.index = (viewer.index + 1) % viewer.images.length">›</button>
        </template>
        <button class="absolute top-4 right-4 rounded bg-white/85 px-3 py-1 text-sm" type="button" @click="viewer = null">Fechar</button>
      </div>
    </template>
  </div>
</template>

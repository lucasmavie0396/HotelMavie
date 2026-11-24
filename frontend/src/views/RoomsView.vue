<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '@/services/api';
import { fileUrl, readImage } from '@/services/files';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { Room, RoomStatus, TaxRate } from '@/types';
import { formatMoney, ROOM_STATUS_CLASSES, ROOM_STATUS_LABELS, ROOM_STATUSES } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const rooms = ref<Room[]>([]);
const error = ref('');
const route = useRoute();
const router = useRouter();
const statusFilter = ref<RoomStatus | ''>(ROOM_STATUSES.includes(route.query.estado as RoomStatus) ? (route.query.estado as RoomStatus) : '');
const visibleRooms = computed(() => (statusFilter.value ? rooms.value.filter((room) => room.status === statusFilter.value) : rooms.value));

function filterStatus(status: RoomStatus | '') {
  statusFilter.value = status;
  router.replace({ query: status ? { estado: status } : {} });
}
const saving = ref(false);

const canManage = computed(() => auth.user?.role === 'ADMIN' || auth.user?.role === 'MANAGER');

const form = reactive({ number: '', type: '', capacity: 2, pricePerNight: 0, floor: undefined as number | undefined, taxRateId: 0 });
const taxRates = ref<TaxRate[]>([]);
const editing = reactive({ id: 0, number: '', type: '', capacity: 2, floor: '' as number | '', pricePerNight: 0, taxRateId: 0 });
const notice = ref('');
const hotelRate = computed(() => taxRates.value.find((rate) => rate.id === hotels.selected?.accommodationTaxRateId) ?? null);
const rateLabel = (rate: { name: string; rate: string } | null) => (rate ? `${rate.name} (${Number(rate.rate)}%)` : '-');

async function load() {
  error.value = '';
  try {
    const params = { hotelId: hotels.selectedId };
    const [r, tr] = await Promise.all([api.get<Room[]>('/rooms', { params }), api.get<TaxRate[]>('/tax-rates', { params })]);
    rooms.value = r.data;
    taxRates.value = tr.data.filter((rate) => rate.active);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function startEdit(room: Room) {
  openId.value = null;
  notice.value = '';
  Object.assign(editing, {
    id: room.id,
    number: room.number,
    type: room.type,
    capacity: room.capacity,
    floor: room.floor ?? '',
    pricePerNight: Number(room.pricePerNight),
    taxRateId: room.taxRateId ?? 0,
  });
}

async function saveEdit(room: Room) {
  saving.value = true;
  error.value = '';
  try {
    const { data } = await api.patch<Room>(`/rooms/${room.id}`, {
      number: editing.number.trim(),
      type: editing.type.trim(),
      capacity: Number(editing.capacity),
      floor: editing.floor === '' ? null : Number(editing.floor),
      pricePerNight: Number(editing.pricePerNight),
      taxRateId: editing.taxRateId || null,
    });
    Object.assign(room, data);
    editing.id = 0;
    notice.value = t('rooms.saved', { number: data.number });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function changeStatus(room: Room, status: RoomStatus) {
  try {
    const { data } = await api.patch<Room>(`/rooms/${room.id}`, { status });
    Object.assign(room, data);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function createRoom() {
  saving.value = true;
  error.value = '';
  try {
    await api.post('/rooms', { ...form, hotelId: hotels.selectedId, pricePerNight: Number(form.pricePerNight), taxRateId: form.taxRateId || null });
    Object.assign(form, { number: '', type: '', capacity: 2, pricePerNight: 0, floor: undefined, taxRateId: 0 });
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

const openId = ref<number | null>(null);
const description = ref('');
const descriptionEn = ref('');

function toggle(room: Room) {
  editing.id = 0;
  openId.value = openId.value === room.id ? null : room.id;
  description.value = room.description ?? '';
  descriptionEn.value = room.descriptionEn ?? '';
}

async function roomAction(room: Room, action: () => Promise<{ data: Room }>) {
  saving.value = true;
  error.value = '';
  try {
    Object.assign(room, (await action()).data);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

const saveDescription = (room: Room) => roomAction(room, () => api.patch<Room>(`/rooms/${room.id}`, { description: description.value || null, descriptionEn: descriptionEn.value || null }));

async function addImages(room: Room, event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  for (const file of files) {
    try {
      const data = await readImage(file);
      await roomAction(room, () => api.post<Room>(`/rooms/${room.id}/images`, { data }));
    } catch (e) {
      error.value = errorMessage(e);
    }
  }
}

const removeImage = (room: Room, imageId: number) => roomAction(room, () => api.delete<Room>(`/rooms/${room.id}/images/${imageId}`));

async function removeRoom(room: Room) {
  if (!window.confirm(t('rooms.confirmDelete', { number: room.number }))) {
    return;
  }
  try {
    await api.delete(`/rooms/${room.id}`);
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  }
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="rooms" :subtitle="t('rooms.subtitle')" />

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <form v-if="canManage" class="card grid gap-3 sm:grid-cols-6" @submit.prevent="createRoom">
      <input v-model="form.number" class="input" :placeholder="t('rooms.number')" required />
      <input v-model="form.type" class="input sm:col-span-2" :placeholder="t('rooms.typeExample')" required />
      <input v-model.number="form.capacity" class="input" type="number" min="1" :placeholder="t('rooms.capacity')" required />
      <input v-model.number="form.pricePerNight" class="input" type="number" min="0" step="0.01" :placeholder="t('reservationDetail.pricePerNight')" required />
      <input v-model.number="form.floor" class="input" type="number" :placeholder="t('rooms.floor')" />
      <select v-model.number="form.taxRateId" class="input sm:col-span-2" :aria-label="t('rooms.vat')">
        <option :value="0">{{ t('rooms.hotelVat', { rate: rateLabel(hotelRate) }) }}</option>
        <option v-for="rate in taxRates" :key="rate.id" :value="rate.id">{{ rateLabel(rate) }}</option>
      </select>
      <button class="btn sm:col-span-4 sm:justify-self-end" type="submit" :disabled="saving">{{ t('rooms.add') }}</button>
    </form>

    <div class="flex flex-wrap gap-2" role="group" :aria-label="t('rooms.filter')">
      <button
        type="button"
        class="rounded-full border px-3 py-1 text-xs font-medium"
        :class="statusFilter === '' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'"
        @click="filterStatus('')"
      >
        {{ t('common.all') }} ({{ rooms.length }})
      </button>
      <button
        v-for="status in ROOM_STATUSES"
        :key="status"
        type="button"
        class="rounded-full border px-3 py-1 text-xs font-medium"
        :class="statusFilter === status ? `${ROOM_STATUS_CLASSES[status]} border-transparent ring-2 ring-slate-400` : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'"
        @click="filterStatus(status)"
      >
        {{ ROOM_STATUS_LABELS[status] }} ({{ rooms.filter((room) => room.status === status).length }})
      </button>
    </div>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('rooms.number') }}</th>
            <th class="px-4 py-3">{{ t('rooms.type') }}</th>
            <th class="px-4 py-3">{{ t('rooms.floor') }}</th>
            <th class="px-4 py-3">{{ t('rooms.capacity') }}</th>
            <th class="px-4 py-3">{{ t('reservationDetail.pricePerNight') }}</th>
            <th class="px-4 py-3">{{ t('rooms.vat') }}</th>
            <th class="px-4 py-3">{{ t('common.status') }}</th>
            <th v-if="canManage" class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="room in visibleRooms" :key="room.id">
          <tr class="border-b border-slate-100 last:border-0">
            <td class="px-4 py-3 font-medium">{{ room.number }}</td>
            <td class="px-4 py-3">{{ room.type }}</td>
            <td class="px-4 py-3">{{ room.floor ?? '-' }}</td>
            <td class="px-4 py-3">{{ room.capacity }}</td>
            <td class="px-4 py-3">{{ formatMoney(room.pricePerNight, hotels.currency) }}</td>
            <td class="px-4 py-3">
              <span v-if="room.taxRate">{{ rateLabel(room.taxRate) }}</span>
              <span v-else class="text-slate-500">{{ t('rooms.hotelVat', { rate: rateLabel(hotelRate) }) }}</span>
            </td>
            <td class="px-4 py-3">
              <select
                class="rounded-full border-0 px-2 py-1 text-xs font-medium"
                :class="ROOM_STATUS_CLASSES[room.status]"
                :value="room.status"
                @change="changeStatus(room, ($event.target as HTMLSelectElement).value as RoomStatus)"
              >
                <option v-for="status in ROOM_STATUSES" :key="status" :value="status">{{ ROOM_STATUS_LABELS[status] }}</option>
              </select>
            </td>
            <td v-if="canManage" class="space-x-3 px-4 py-3 text-right whitespace-nowrap">
              <button class="text-xs font-semibold text-indigo-600 hover:underline" type="button" @click="editing.id === room.id ? (editing.id = 0) : startEdit(room)">{{ t('common.edit') }}</button>
              <button class="text-xs text-indigo-600 hover:underline" type="button" @click="toggle(room)">
                {{ t('rooms.photos', { n: room.images.length }) }}
              </button>
              <button class="text-xs text-rose-600 hover:underline" type="button" @click="removeRoom(room)">{{ t('common.delete') }}</button>
            </td>
          </tr>
          <tr v-if="canManage && editing.id === room.id" class="border-b border-slate-100 bg-indigo-50/50">
            <td colspan="8" class="px-4 py-4">
              <form class="grid gap-3 sm:grid-cols-6" :data-testid="`room-edit-${room.id}`" @submit.prevent="saveEdit(room)">
                <label class="text-sm">
                  <span class="mb-1 block text-slate-600">{{ t('rooms.number') }}</span>
                  <input v-model="editing.number" class="input" maxlength="20" required />
                </label>
                <label class="text-sm sm:col-span-2">
                  <span class="mb-1 block text-slate-600">{{ t('rooms.type') }}</span>
                  <input v-model="editing.type" class="input" maxlength="60" required />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block text-slate-600">{{ t('rooms.capacity') }}</span>
                  <input v-model.number="editing.capacity" class="input" type="number" min="1" required />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block text-slate-600">{{ t('rooms.floor') }}</span>
                  <input v-model.number="editing.floor" class="input" type="number" />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block text-slate-600">{{ t('reservationDetail.pricePerNight') }}</span>
                  <input v-model.number="editing.pricePerNight" class="input" type="number" min="0" step="0.01" inputmode="decimal" required />
                </label>
                <label class="text-sm sm:col-span-3">
                  <span class="mb-1 block text-slate-600">{{ t('rooms.vat') }}</span>
                  <select v-model.number="editing.taxRateId" class="input">
                    <option :value="0">{{ t('rooms.hotelVat', { rate: rateLabel(hotelRate) }) }}</option>
                    <option v-for="rate in taxRates" :key="rate.id" :value="rate.id">{{ rateLabel(rate) }}</option>
                  </select>
                </label>
                <p class="text-xs text-slate-500 sm:col-span-3 sm:self-end">{{ t('rooms.editHint') }}</p>
                <div class="flex justify-end gap-2 sm:col-span-6">
                  <button class="btn-secondary" type="button" @click="editing.id = 0">{{ t('common.cancel') }}</button>
                  <button class="btn" type="submit" :disabled="saving">{{ t('common.save') }}</button>
                </div>
              </form>
            </td>
          </tr>
          <tr v-if="canManage && openId === room.id" class="border-b border-slate-100 bg-slate-50">
            <td colspan="8" class="space-y-3 px-4 py-4">
              <form class="flex flex-wrap items-end gap-2" @submit.prevent="saveDescription(room)">
                <label class="min-w-72 flex-1 text-sm">
                  {{ t('rooms.description') }}
                  <textarea v-model="description" class="input" rows="2" :placeholder="t('rooms.descriptionExample')" />
                </label>
                <label class="min-w-72 flex-1 text-sm">
                  {{ t('rooms.descriptionEn') }}
                  <textarea v-model="descriptionEn" class="input" rows="2" placeholder="Double bed, sea-view balcony, air conditioning, Wi-Fi..." />
                </label>
                <button class="btn-secondary" type="submit" :disabled="saving">{{ t('rooms.saveDescription') }}</button>
              </form>
              <div class="flex flex-wrap gap-3">
                <figure v-for="image in room.images" :key="image.id" class="relative h-24 w-36 overflow-hidden rounded-md border border-slate-200 bg-white">
                  <img :src="fileUrl(image.file)" :alt="t('dashboard.room', { number: room.number })" class="h-full w-full object-cover" />
                  <button
                    class="absolute top-1 right-1 rounded bg-white/90 px-1.5 text-xs text-rose-600 shadow hover:bg-white"
                    type="button"
                    :disabled="saving"
                    @click="removeImage(room, image.id)"
                  >
                    {{ t('common.remove') }}
                  </button>
                </figure>
                <label
                  v-if="room.images.length < 8"
                  class="flex h-24 w-36 cursor-pointer items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-center text-xs text-slate-500 hover:border-indigo-400"
                  :class="saving ? 'pointer-events-none opacity-60' : ''"
                >
                  {{ t('rooms.addPhotos') }}<br />{{ t('rooms.photoFormats') }}
                  <input class="hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple @change="addImages(room, $event)" />
                </label>
              </div>
              <p class="text-xs text-slate-500">{{ t('rooms.photoHint') }}</p>
            </td>
          </tr>
          </template>
          <tr v-if="!visibleRooms.length">
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">{{ statusFilter ? t('rooms.noneInStatus') : t('rooms.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

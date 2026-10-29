<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '@/services/api';
import { fileUrl, readImage } from '@/services/files';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { Room, RoomStatus } from '@/types';
import { formatMoney, ROOM_STATUS_CLASSES, ROOM_STATUS_LABELS, ROOM_STATUSES } from '@/utils/format';

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

const form = reactive({ number: '', type: '', capacity: 2, pricePerNight: 0, floor: undefined as number | undefined });

async function load() {
  error.value = '';
  try {
    rooms.value = (await api.get<Room[]>('/rooms', { params: { hotelId: hotels.selectedId } })).data;
  } catch (e) {
    error.value = errorMessage(e);
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
    await api.post('/rooms', { ...form, hotelId: hotels.selectedId, pricePerNight: Number(form.pricePerNight) });
    Object.assign(form, { number: '', type: '', capacity: 2, pricePerNight: 0, floor: undefined });
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

const openId = ref<number | null>(null);
const description = ref('');

function toggle(room: Room) {
  openId.value = openId.value === room.id ? null : room.id;
  description.value = room.description ?? '';
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

const saveDescription = (room: Room) => roomAction(room, () => api.patch<Room>(`/rooms/${room.id}`, { description: description.value || null }));

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
  if (!window.confirm(`Apagar o quarto ${room.number}?`)) {
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
    <h1 class="text-2xl font-semibold">Quartos</h1>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <form v-if="canManage" class="card grid gap-3 sm:grid-cols-6" @submit.prevent="createRoom">
      <input v-model="form.number" class="input" placeholder="Numero" required />
      <input v-model="form.type" class="input sm:col-span-2" placeholder="Tipo (ex.: Standard)" required />
      <input v-model.number="form.capacity" class="input" type="number" min="1" placeholder="Capacidade" required />
      <input v-model.number="form.pricePerNight" class="input" type="number" min="0" step="0.01" placeholder="Preco/noite" required />
      <input v-model.number="form.floor" class="input" type="number" placeholder="Piso" />
      <button class="btn sm:col-span-6 sm:justify-self-end" type="submit" :disabled="saving">Adicionar quarto</button>
    </form>

    <div class="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
      <button
        type="button"
        class="rounded-full border px-3 py-1 text-xs font-medium"
        :class="statusFilter === '' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'"
        @click="filterStatus('')"
      >
        Todos ({{ rooms.length }})
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
            <th class="px-4 py-3">Numero</th>
            <th class="px-4 py-3">Tipo</th>
            <th class="px-4 py-3">Piso</th>
            <th class="px-4 py-3">Capacidade</th>
            <th class="px-4 py-3">Preco/noite</th>
            <th class="px-4 py-3">Estado</th>
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
              <button class="text-xs text-indigo-600 hover:underline" type="button" @click="toggle(room)">
                Fotos e descricao ({{ room.images.length }})
              </button>
              <button class="text-xs text-rose-600 hover:underline" type="button" @click="removeRoom(room)">Apagar</button>
            </td>
          </tr>
          <tr v-if="canManage && openId === room.id" class="border-b border-slate-100 bg-slate-50">
            <td colspan="7" class="space-y-3 px-4 py-4">
              <form class="flex flex-wrap items-end gap-2" @submit.prevent="saveDescription(room)">
                <label class="min-w-72 flex-1 text-sm">
                  Descricao no site publico
                  <textarea v-model="description" class="input" rows="2" placeholder="Cama de casal, varanda com vista mar, ar condicionado, Wi-Fi..." />
                </label>
                <button class="btn-secondary" type="submit" :disabled="saving">Guardar descricao</button>
              </form>
              <div class="flex flex-wrap gap-3">
                <figure v-for="image in room.images" :key="image.id" class="relative h-24 w-36 overflow-hidden rounded-md border border-slate-200 bg-white">
                  <img :src="fileUrl(image.file)" :alt="`Quarto ${room.number}`" class="h-full w-full object-cover" />
                  <button
                    class="absolute top-1 right-1 rounded bg-white/90 px-1.5 text-xs text-rose-600 shadow hover:bg-white"
                    type="button"
                    :disabled="saving"
                    @click="removeImage(room, image.id)"
                  >
                    Remover
                  </button>
                </figure>
                <label
                  v-if="room.images.length < 8"
                  class="flex h-24 w-36 cursor-pointer items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-center text-xs text-slate-500 hover:border-indigo-400"
                  :class="saving ? 'pointer-events-none opacity-60' : ''"
                >
                  + Adicionar fotos<br />(JPG, PNG, WEBP ate 4 MB)
                  <input class="hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple @change="addImages(room, $event)" />
                </label>
              </div>
              <p class="text-xs text-slate-500">Ate 8 fotos por quarto. No site, os quartos do mesmo tipo partilham as fotografias.</p>
            </td>
          </tr>
          </template>
          <tr v-if="!visibleRooms.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">{{ statusFilter ? 'Nenhum quarto neste estado' : 'Sem quartos registados' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

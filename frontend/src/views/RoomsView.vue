<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { Room, RoomStatus } from '@/types';
import { formatMoney, ROOM_STATUS_CLASSES, ROOM_STATUS_LABELS, ROOM_STATUSES } from '@/utils/format';

const auth = useAuthStore();
const hotels = useHotelsStore();
const rooms = ref<Room[]>([]);
const error = ref('');
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
          <tr v-for="room in rooms" :key="room.id" class="border-b border-slate-100 last:border-0">
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
            <td v-if="canManage" class="px-4 py-3 text-right">
              <button class="text-xs text-rose-600 hover:underline" type="button" @click="removeRoom(room)">Apagar</button>
            </td>
          </tr>
          <tr v-if="!rooms.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">Sem quartos registados</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

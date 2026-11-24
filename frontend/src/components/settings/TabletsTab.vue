<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { askConfirm } from '@/services/dialog';
import { useHotelsStore } from '@/stores/hotels';
import type { Room, RoomDevice, RoomServiceSettings } from '@/types';
import { formatDateTime } from '@/utils/format';
import { localeTag } from '@/i18n';

const { t } = useI18n();
const hotels = useHotelsStore();
const devices = ref<RoomDevice[]>([]);
const rooms = ref<Room[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const settings = reactive({ autoAccept: false, restaurantHours: '', barHours: '' });
const form = reactive({ roomId: 0, name: '' });
const tabletAddress = computed(() => `${window.location.origin}/quarto`);
const sortedRooms = computed(() => [...rooms.value].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })));
const time = (value: string) => new Date(value).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });

async function load() {
  const params = { hotelId: hotels.selectedId };
  const [d, r, s] = await Promise.all([
    api.get<RoomDevice[]>('/room-devices', { params }),
    api.get<Room[]>('/rooms', { params }),
    api.get<RoomServiceSettings>('/room-devices/settings', { params }),
  ]);
  devices.value = d.data;
  rooms.value = r.data;
  Object.assign(settings, { autoAccept: s.data.autoAccept, restaurantHours: s.data.restaurantHours ?? '', barHours: s.data.barHours ?? '' });
  if (!form.roomId) form.roomId = sortedRooms.value[0]?.id ?? 0;
}

async function run(action: () => Promise<unknown>, message: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    notice.value = message;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const saveSettings = () =>
  run(
    () =>
      api.patch('/room-devices/settings', {
        hotelId: hotels.selectedId,
        autoAccept: settings.autoAccept,
        restaurantHours: settings.restaurantHours.trim(),
        barHours: settings.barHours.trim(),
      }),
    t('tablets.saved'),
  );

const create = () =>
  run(async () => {
    await api.post('/room-devices', { hotelId: hotels.selectedId, roomId: form.roomId, name: form.name.trim() || undefined });
    form.name = '';
  }, t('tablets.created'));

const newCode = (device: RoomDevice) => run(() => api.post(`/room-devices/${device.id}/code`), t('tablets.created'));
const changeRoom = (device: RoomDevice, roomId: number) => run(() => api.patch(`/room-devices/${device.id}`, { roomId }), t('tablets.updated'));

async function toggle(device: RoomDevice) {
  if (device.active && !(await askConfirm({ title: t('tablets.turnOff'), message: t('tablets.turnOffConfirm'), danger: true, confirmLabel: t('tablets.turnOff') }))) return;
  await run(() => api.patch(`/room-devices/${device.id}`, { active: !device.active }), t('tablets.updated'));
}

async function remove(device: RoomDevice) {
  if (!(await askConfirm({ title: t('tablets.remove'), message: t('tablets.removeConfirm'), danger: true, confirmLabel: t('tablets.remove') }))) return;
  await run(() => api.delete(`/room-devices/${device.id}`), t('tablets.updated'));
}

onMounted(() => load().catch((e) => (error.value = errorMessage(e))));
</script>

<template>
  <div class="space-y-4">
    <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
    <p v-if="notice" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{{ notice }}</p>

    <div class="card space-y-2">
      <p class="text-sm text-slate-600">{{ t('tablets.intro') }}</p>
      <p class="text-sm">
        {{ t('tablets.address') }}:
        <code class="rounded bg-slate-100 px-2 py-1 font-semibold select-all">{{ tabletAddress }}</code>
      </p>
    </div>

    <form class="card space-y-3" @submit.prevent="saveSettings">
      <h2 class="font-semibold">{{ t('tablets.settings') }}</h2>
      <label class="flex items-center gap-2 text-sm"><input v-model="settings.autoAccept" type="checkbox" />{{ t('tablets.autoAccept') }}</label>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('tablets.restaurantHours') }}</span>
          <input v-model="settings.restaurantHours" class="input" placeholder="11:00-23:00" maxlength="11" />
        </label>
        <label class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('tablets.barHours') }}</span>
          <input v-model="settings.barHours" class="input" placeholder="10:00-00:00" maxlength="11" />
        </label>
      </div>
      <p class="text-xs text-slate-500">{{ t('tablets.hoursHint') }}</p>
      <div class="flex justify-end">
        <button class="btn" type="submit" :disabled="busy">{{ t('tablets.saveSettings') }}</button>
      </div>
    </form>

    <form class="card grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end" @submit.prevent="create">
      <h2 class="font-semibold sm:col-span-3">{{ t('tablets.newTablet') }}</h2>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('tablets.room') }}</span>
        <select v-model.number="form.roomId" class="input" required>
          <option v-for="room in sortedRooms" :key="room.id" :value="room.id">{{ room.number }} · {{ room.type }}</option>
        </select>
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('tablets.name') }}</span>
        <input v-model="form.name" class="input" maxlength="60" />
      </label>
      <button class="btn" type="submit" :disabled="busy || !form.roomId">{{ t('tablets.create') }}</button>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('tablets.room') }}</th>
            <th class="px-4 py-3">{{ t('tablets.state') }}</th>
            <th class="px-4 py-3">{{ t('tablets.code') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="device in devices" :key="device.id" class="border-b border-slate-100" :class="device.active ? '' : 'text-slate-400'">
            <td class="px-4 py-3">
              <select class="input w-36" :value="device.roomId" :aria-label="t('tablets.changeRoom')" :disabled="busy" @change="changeRoom(device, Number(($event.target as HTMLSelectElement).value))">
                <option v-for="room in sortedRooms" :key="room.id" :value="room.id">{{ t('tablet.room', { number: room.number }) }}</option>
              </select>
              <span v-if="device.name" class="mt-1 block text-xs text-slate-500">{{ device.name }}</span>
            </td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                :class="!device.active ? 'bg-slate-100 text-slate-500' : device.paired ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
              >
                {{ !device.active ? t('tablets.off') : device.paired ? t('tablets.pairedState') : t('tablets.waiting') }}
              </span>
              <span class="mt-1 block text-xs text-slate-500">{{ device.lastSeenAt ? t('tablets.lastSeen', { date: formatDateTime(device.lastSeenAt) }) : t('tablets.never') }}</span>
            </td>
            <td class="px-4 py-3">
              <template v-if="device.pairingCode">
                <span class="font-mono text-2xl font-bold tracking-widest text-indigo-700" data-testid="pairing-code">{{ device.pairingCode }}</span>
                <span class="block text-xs text-slate-500">{{ t('tablets.validUntil', { time: time(device.pairingExpiresAt!) }) }}</span>
              </template>
              <span v-else class="text-slate-400">-</span>
            </td>
            <td class="space-x-3 px-4 py-3 text-right text-xs whitespace-nowrap">
              <button v-if="device.active" class="text-indigo-600 hover:underline" type="button" :disabled="busy" @click="newCode(device)">{{ t('tablets.newCode') }}</button>
              <button class="hover:underline" :class="device.active ? 'text-amber-700' : 'text-emerald-700'" type="button" :disabled="busy" @click="toggle(device)">
                {{ device.active ? t('tablets.turnOff') : t('tablets.turnOn') }}
              </button>
              <button class="text-rose-600 hover:underline" type="button" :disabled="busy" @click="remove(device)">{{ t('tablets.remove') }}</button>
            </td>
          </tr>
          <tr v-if="!devices.length">
            <td colspan="4" class="px-4 py-6 text-center text-slate-500">{{ t('tablets.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

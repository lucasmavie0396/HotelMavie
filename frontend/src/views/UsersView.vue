<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { translated } from '@/i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { BackupStatus, UserRole } from '@/types';
import { formatDateTime } from '@/utils/format';

interface StaffUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  hotelId: number | null;
  totpEnabled: boolean;
  createdAt: string;
}

interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

const ROLE_LABELS = translated<UserRole>('labels.role', ['ADMIN', 'MANAGER', 'RECEPTION']);

const { t } = useI18n();
const hotels = useHotelsStore();
const users = ref<StaffUser[]>([]);
const backups = ref<BackupFile[]>([]);
const backupStatus = ref<BackupStatus | null>(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const editingId = ref<number | null>(null);

function emptyForm() {
  return { name: '', email: '', password: '', role: 'RECEPTION' as UserRole, hotelId: hotels.selectedId ?? 0, active: true };
}

const form = reactive(emptyForm());

async function load() {
  try {
    const [u, b, s] = await Promise.all([api.get<StaffUser[]>('/users'), api.get<BackupFile[]>('/backups'), api.get<BackupStatus>('/backups/status')]);
    users.value = u.data;
    backups.value = b.data;
    backupStatus.value = s.data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(fn: () => Promise<unknown>, message = '') {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
    notice.value = message;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function edit(user: StaffUser) {
  editingId.value = user.id;
  Object.assign(form, { name: user.name, email: user.email, password: '', role: user.role, hotelId: user.hotelId ?? 0, active: user.active });
}

function reset() {
  editingId.value = null;
  Object.assign(form, emptyForm());
}

const save = () =>
  run(async () => {
    const payload = {
      name: form.name,
      email: form.email,
      role: form.role,
      active: form.active,
      hotelId: form.role === 'ADMIN' ? undefined : form.hotelId || undefined,
      ...(form.password ? { password: form.password } : {}),
    };
    if (editingId.value) {
      await api.patch(`/users/${editingId.value}`, payload);
    } else {
      await api.post('/users', payload);
    }
    reset();
  }, t('users.saved'));

const createBackup = () => run(() => api.post('/backups'), t('users.backupCreated'));

const runScheduled = () =>
  run(async () => {
    const { data } = await api.post<BackupStatus['lastRun']>('/backups/run-scheduled');
    if (data && !data.ok) throw new Error(data.error);
  }, t('users.backupRun'));

const resetTwoFactor = (user: StaffUser) =>
  run(async () => {
    if (!window.confirm(t('users.confirmReset2fa', { name: user.name }))) return;
    await api.post(`/users/${user.id}/2fa/reset`);
  }, t('users.twoFactorReset'));

async function download(name: string) {
  try {
    const { data } = await api.get<Blob>(`/backups/${name}`, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="users" :title="t('users.title')" :subtitle="t('users.subtitle')" />

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <form class="card grid gap-3 sm:grid-cols-3" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-3">{{ editingId ? t('users.edit') : t('users.new') }}</h2>
      <input v-model="form.name" class="input" :placeholder="t('common.name')" required />
      <input v-model="form.email" class="input" type="email" placeholder="Email" required />
      <input
        v-model="form.password"
        class="input"
        type="password"
        autocomplete="new-password"
        :placeholder="editingId ? t('users.newPassword') : t('users.password')"
        :required="!editingId"
        minlength="8"
      />
      <select v-model="form.role" class="input">
        <option v-for="(label, role) in ROLE_LABELS" :key="role" :value="role">{{ label }}</option>
      </select>
      <select v-model.number="form.hotelId" class="input" :disabled="form.role === 'ADMIN'">
        <option v-for="hotel in hotels.hotels" :key="hotel.id" :value="hotel.id">{{ hotel.name }}</option>
      </select>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.active" type="checkbox" />{{ t('common.active') }}</label>
      <p class="text-xs text-slate-500 sm:col-span-2">
        {{ t('users.rolesHint') }}
      </p>
      <div class="flex justify-end gap-2">
        <button v-if="editingId" class="btn-secondary" type="button" @click="reset">{{ t('common.cancel') }}</button>
        <button class="btn" type="submit" :disabled="busy">{{ t('common.save') }}</button>
      </div>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('common.name') }}</th>
            <th class="px-4 py-3">Email</th>
            <th class="px-4 py-3">{{ t('users.role') }}</th>
            <th class="px-4 py-3">Hotel</th>
            <th class="px-4 py-3">{{ t('common.status') }}</th>
            <th class="px-4 py-3">2FA</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id" class="border-b border-slate-100" :class="user.active ? '' : 'text-slate-400'">
            <td class="px-4 py-3 font-medium">{{ user.name }}</td>
            <td class="px-4 py-3">{{ user.email }}</td>
            <td class="px-4 py-3">{{ ROLE_LABELS[user.role] }}</td>
            <td class="px-4 py-3">{{ user.hotelId ? hotels.nameOf(user.hotelId) : t('common.all') }}</td>
            <td class="px-4 py-3">{{ user.active ? t('common.active') : t('common.inactive') }}</td>
            <td class="px-4 py-3">
              <span class="rounded-full px-2 py-0.5 text-xs" :class="user.totpEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'">
                {{ user.totpEnabled ? t('common.active') : t('common.no') }}
              </span>
            </td>
            <td class="space-x-3 px-4 py-3 text-right whitespace-nowrap">
              <button v-if="user.totpEnabled" class="text-xs text-rose-600 hover:underline" type="button" :disabled="busy" @click="resetTwoFactor(user)">{{ t('users.reset2fa') }}</button>
              <button class="text-xs text-indigo-600 hover:underline" type="button" @click="edit(user)">{{ t('common.edit') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">{{ t('users.backups') }}</h2>
        <button class="btn" type="button" :disabled="busy" @click="createBackup">{{ t('users.createBackup') }}</button>
      </div>
      <div v-if="backupStatus" class="rounded-xl p-3 text-sm" :class="backupStatus.enabled ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'">
        <template v-if="backupStatus.enabled">
          <p>
            {{ t('users.autoBackup', { hour: String(backupStatus.hour).padStart(2, '0'), days: backupStatus.keepDays }) }}{{
              backupStatus.copyDir ? t('users.copyTo', { dir: backupStatus.copyDir }) : t('users.noCopy')
            }}.
          </p>
          <p v-if="backupStatus.nextRunAt" class="text-xs">{{ t('users.next') }}: {{ formatDateTime(backupStatus.nextRunAt) }}</p>
          <p v-if="backupStatus.lastRun" class="text-xs" :class="backupStatus.lastRun.ok ? '' : 'font-semibold text-rose-700'">
            {{ t('users.last') }}: {{ formatDateTime(backupStatus.lastRun.at) }} · {{ backupStatus.lastRun.ok ? `${backupStatus.lastRun.file}${backupStatus.lastRun.copied ? ` (${t('users.copied')})` : ''}` : backupStatus.lastRun.error }}
          </p>
          <button class="mt-2 text-xs font-medium text-indigo-700 hover:underline" type="button" :disabled="busy" @click="runScheduled">{{ t('users.runScheduled') }}</button>
        </template>
        <p v-else>
          {{ t('users.autoOff') }}
        </p>
      </div>
      <p class="text-xs text-slate-500">{{ t('users.backupDir') }}</p>
      <ul class="divide-y divide-slate-100 text-sm">
        <li v-for="file in backups" :key="file.name" class="flex items-center justify-between py-2">
          <span>{{ file.name }} <span class="text-slate-500">· {{ formatDateTime(file.createdAt) }} · {{ (file.size / 1024).toFixed(0) }} KB</span></span>
          <button class="text-xs text-indigo-600 hover:underline" type="button" @click="download(file.name)">{{ t('common.download') }}</button>
        </li>
        <li v-if="!backups.length" class="py-2 text-slate-500">{{ t('users.noBackups') }}</li>
      </ul>
    </div>
  </section>
</template>

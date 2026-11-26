<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { askConfirm } from '@/services/dialog';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import { useLicenseStore } from '@/stores/license';
import { formatDateTime } from '@/utils/format';

interface Production {
  inProduction: boolean;
  since: string | null;
  confirmation: string;
  counts: Record<string, number>;
}

interface CleanupItem {
  type: 'BACKUPS' | 'SESSIONS' | 'EMAIL_LOGS';
  count: number;
  bytes?: number;
  minimum: number;
  location?: string;
  total?: number;
}

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const license = useLicenseStore();
const isAdmin = computed(() => auth.user?.role === 'ADMIN');
const production = ref<Production | null>(null);
const cleanup = ref<CleanupItem[]>([]);
const licenseText = ref('');
const unlockText = ref('');
const confirmation = ref('');
const deleteData = ref(true);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const keep = ref(7);
const emailDays = ref(90);
const STATE_CLASSES: Record<string, string> = {
  VALID: 'bg-emerald-50 text-emerald-800',
  TRIAL: 'bg-sky-50 text-sky-900',
  EXPIRING: 'bg-amber-50 text-amber-900',
  GRACE: 'bg-amber-50 text-amber-900',
};

async function load() {
  error.value = '';
  try {
    await license.load(true);
    if (isAdmin.value) {
      const params = { hotelId: hotels.selectedId };
      production.value = (await api.get<Production>('/system/production', { params })).data;
      cleanup.value = (await api.get<{ items: CleanupItem[] }>('/system/cleanup', { params })).data.items;
    }
  } catch (e) {
    error.value = errorMessage(e);
  }
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

const activate = () =>
  run(async () => {
    await api.post('/license', { hotelId: hotels.selectedId, text: licenseText.value });
    licenseText.value = '';
  }, t('system.activated'));

const unlock = () =>
  run(async () => {
    await api.post('/license/unlock', { hotelId: hotels.selectedId, text: unlockText.value });
    unlockText.value = '';
  }, t('system.unlocked'));

async function start() {
  const message = deleteData.value ? t('system.confirmDelete') : t('system.confirmKeep');
  if (!(await askConfirm({ title: t('system.startTitle'), message, danger: deleteData.value, confirmLabel: t('system.start') }))) return;
  await run(
    () => api.post('/system/production', { hotelId: hotels.selectedId, deleteTestData: deleteData.value, confirmation: deleteData.value ? confirmation.value : undefined }),
    t('system.started'),
  );
}

const clean = (item: CleanupItem) =>
  run(
    () => api.post('/system/cleanup', { hotelId: hotels.selectedId, type: item.type, value: item.type === 'BACKUPS' ? keep.value : item.type === 'EMAIL_LOGS' ? emailDays.value : undefined }),
    t('system.cleaned'),
  );

const size = (bytes?: number) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '');

onMounted(load);
</script>

<template>
  <div class="space-y-4" data-testid="system-tab">
    <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
    <p v-if="notice" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{{ notice }}</p>

    <section class="card space-y-3">
      <h2 class="font-semibold">{{ t('system.license') }}</h2>
      <template v-if="license.status">
        <p class="rounded-lg px-3 py-2 text-sm" :class="STATE_CLASSES[license.status.state] ?? 'bg-rose-50 text-rose-800'" data-testid="license-state">{{ license.status.message }}</p>
        <dl class="grid gap-2 text-sm sm:grid-cols-3">
          <div><dt class="text-slate-500">{{ t('system.licensed') }}</dt><dd class="font-medium">{{ license.status.name ?? '-' }}</dd></div>
          <div><dt class="text-slate-500">NUIT</dt><dd class="font-medium">{{ license.status.nuit ?? '-' }}</dd></div>
          <div><dt class="text-slate-500">{{ t('system.validUntil') }}</dt><dd class="font-medium">{{ license.status.validUntil ?? license.status.trialUntil ?? '-' }}</dd></div>
        </dl>
      </template>
      <template v-if="isAdmin">
        <form class="space-y-2" @submit.prevent="activate">
          <label class="block text-sm">
            <span class="mb-1 block text-slate-600">{{ t('system.activateHint') }}</span>
            <textarea v-model="licenseText" class="input font-mono text-xs" rows="3" placeholder="MAVIE1...." required></textarea>
          </label>
          <div class="flex justify-end"><button class="btn" type="submit" :disabled="busy || !licenseText.trim()">{{ t('system.activate') }}</button></div>
        </form>
        <form v-if="license.status?.state === 'CLOCK'" class="space-y-2 rounded-lg bg-rose-50 p-3" @submit.prevent="unlock">
          <p class="text-sm">{{ t('system.unlockHint', { request: license.status.unlockRequest }) }}</p>
          <textarea v-model="unlockText" class="input font-mono text-xs" rows="2" placeholder="MAVIER1...." required></textarea>
          <div class="flex justify-end"><button class="btn" type="submit" :disabled="busy">{{ t('system.unlock') }}</button></div>
        </form>
      </template>
    </section>

    <section v-if="isAdmin && production" class="card space-y-3" data-testid="production">
      <h2 class="font-semibold">{{ t('system.production') }}</h2>
      <p v-if="production.inProduction" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{{ t('system.inProduction', { date: production.since ? formatDateTime(production.since) : '-' }) }}</p>
      <template v-else>
        <p class="text-sm text-slate-600">{{ t('system.productionHint') }}</p>
        <ul class="grid gap-1 text-sm sm:grid-cols-3">
          <li v-for="(value, key) in production.counts" :key="key" class="flex justify-between rounded bg-slate-50 px-2 py-1">
            <span>{{ t(`system.counts.${key}`) }}</span><strong class="tabular-nums">{{ value }}</strong>
          </li>
        </ul>
        <div class="flex flex-wrap gap-4 text-sm">
          <label class="flex items-center gap-2"><input v-model="deleteData" type="radio" :value="true" />{{ t('system.deleteData') }}</label>
          <label class="flex items-center gap-2"><input v-model="deleteData" type="radio" :value="false" />{{ t('system.keepData') }}</label>
        </div>
        <label v-if="deleteData" class="block text-sm">
          <span class="mb-1 block text-slate-600">{{ t('system.typePhrase', { phrase: production.confirmation }) }}</span>
          <input v-model="confirmation" class="input" autocomplete="off" />
        </label>
        <div class="flex justify-end">
          <button class="btn" :class="deleteData ? 'bg-rose-600 hover:bg-rose-700' : ''" type="button" :disabled="busy || (deleteData && confirmation.trim() !== production.confirmation)" @click="start">
            {{ t('system.start') }}
          </button>
        </div>
      </template>
    </section>

    <section v-if="isAdmin && cleanup.length" class="card space-y-3">
      <h2 class="font-semibold">{{ t('system.cleanup') }}</h2>
      <p class="text-sm text-slate-600">{{ t('system.cleanupHint') }}</p>
      <div v-for="item in cleanup" :key="item.type" class="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm">
        <div class="min-w-64 flex-1">
          <p class="font-medium">{{ t(`system.cleanupItems.${item.type}`) }}</p>
          <p class="text-xs text-slate-500">
            {{ t('system.toRemove', { n: item.count }) }} {{ size(item.bytes) }}
            <template v-if="item.location"> · {{ item.location }}</template>
          </p>
        </div>
        <label v-if="item.type === 'BACKUPS'" class="flex items-center gap-1">{{ t('system.keepNewest') }} <input v-model.number="keep" class="input w-20" type="number" :min="item.minimum" /></label>
        <label v-if="item.type === 'EMAIL_LOGS'" class="flex items-center gap-1">{{ t('system.olderThan') }} <input v-model.number="emailDays" class="input w-20" type="number" :min="item.minimum" /></label>
        <button class="btn-secondary" type="button" :disabled="busy || !item.count" @click="clean(item)">{{ t('system.clean') }}</button>
      </div>
    </section>
  </div>
</template>

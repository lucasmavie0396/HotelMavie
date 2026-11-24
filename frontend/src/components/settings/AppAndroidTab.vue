<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { formatDateTime } from '@/utils/format';

interface ServerAddress {
  address: string;
  server: string;
  download: string;
  downloadQr: string;
  panelQr: string;
  roomQr: string;
}

interface AppInfo {
  available: boolean;
  size: number | null;
  updatedAt: string | null;
  path: string;
  servers: ServerAddress[];
}

const { t } = useI18n();
const info = ref<AppInfo | null>(null);
const selected = ref('');
const error = ref('');
const current = computed(() => info.value?.servers.find((server) => server.address === selected.value) ?? info.value?.servers[0] ?? null);
const size = computed(() => (info.value?.size ? `${(info.value.size / 1024 / 1024).toFixed(1)} MB` : ''));

onMounted(async () => {
  try {
    info.value = (await api.get<AppInfo>('/app/info')).data;
    selected.value = info.value.servers[0]?.address ?? '';
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <div class="space-y-4" data-testid="app-android">
    <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
    <template v-if="info">
      <div class="card space-y-2">
        <h2 class="font-semibold">{{ t('appAndroid.title') }}</h2>
        <p class="text-sm text-slate-600">{{ t('appAndroid.intro') }}</p>
        <p v-if="info.available" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {{ t('appAndroid.available', { size, date: info.updatedAt ? formatDateTime(info.updatedAt) : '-' }) }}
        </p>
        <p v-else class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{{ t('appAndroid.missing') }}</p>
      </div>

      <div v-if="info.servers.length > 1" class="card flex flex-wrap items-center gap-2 text-sm">
        <span class="text-slate-600">{{ t('appAndroid.address') }}</span>
        <button
          v-for="server in info.servers"
          :key="server.address"
          type="button"
          class="chip"
          :class="selected === server.address ? 'bg-indigo-600 text-white' : 'bg-white ring-1 ring-slate-300'"
          @click="selected = server.address"
        >
          {{ server.address }}
        </button>
      </div>
      <p v-if="!info.servers.length" class="card text-sm text-slate-500">{{ t('appAndroid.noNetwork') }}</p>

      <div v-if="current" class="grid gap-4 lg:grid-cols-3">
        <section class="card space-y-2 text-center">
          <h3 class="font-semibold">{{ t('appAndroid.step1') }}</h3>
          <img :src="current.downloadQr" :alt="t('appAndroid.step1')" class="mx-auto size-48" data-testid="apk-qr" />
          <a :href="info.path" class="block text-xs break-all text-indigo-600 hover:underline">{{ current.download }}</a>
        </section>
        <section class="card space-y-2 text-center">
          <h3 class="font-semibold">{{ t('appAndroid.step2panel') }}</h3>
          <img :src="current.panelQr" :alt="t('appAndroid.step2panel')" class="mx-auto size-48" />
          <p class="text-xs text-slate-500">{{ t('appAndroid.panelHint', { server: current.server }) }}</p>
        </section>
        <section class="card space-y-2 text-center">
          <h3 class="font-semibold">{{ t('appAndroid.step2room') }}</h3>
          <img :src="current.roomQr" :alt="t('appAndroid.step2room')" class="mx-auto size-48" />
          <p class="text-xs text-slate-500">{{ t('appAndroid.roomHint') }}</p>
        </section>
      </div>

      <div class="card space-y-2 text-sm text-slate-700">
        <h3 class="font-semibold">{{ t('appAndroid.howTo') }}</h3>
        <ol class="list-decimal space-y-1 pl-5">
          <li>{{ t('appAndroid.how1') }}</li>
          <li>{{ t('appAndroid.how2') }}</li>
          <li>{{ t('appAndroid.how3') }}</li>
          <li>{{ t('appAndroid.how4') }}</li>
          <li>{{ t('appAndroid.how5') }}</li>
        </ol>
        <p class="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{{ t('appAndroid.whatsapp') }}</p>
      </div>
    </template>
  </div>
</template>

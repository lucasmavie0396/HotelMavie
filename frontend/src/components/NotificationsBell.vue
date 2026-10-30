<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { locale } from '@/i18n';
import { api } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';

interface Notice {
  kind: 'info' | 'warning' | 'danger';
  text: string;
  link: string;
}

const COLORS: Record<Notice['kind'], string> = {
  info: 'bg-sky-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-600',
};

const { t } = useI18n();
const hotels = useHotelsStore();
const notices = ref<Notice[]>([]);
watch(locale, () => load());
const open = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  if (!hotels.selectedId) return;
  try {
    notices.value = (await api.get<Notice[]>('/notifications', { params: { hotelId: hotels.selectedId } })).data;
  } catch {
    notices.value = [];
  }
}

onMounted(() => {
  load();
  timer = setInterval(load, 60_000);
});
onBeforeUnmount(() => clearInterval(timer));
defineExpose({ load });
</script>

<template>
  <div class="relative">
    <button class="btn-secondary relative px-3" type="button" :aria-label="t('alerts.button')" @click="open = !open; load()">
      {{ t('alerts.button') }}
      <span
        v-if="notices.length"
        class="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-xs text-white"
      >
        {{ notices.length }}
      </span>
    </button>
    <div v-if="open" class="absolute right-0 z-20 mt-2 w-80 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
      <RouterLink
        v-for="notice in notices"
        :key="notice.text"
        :to="notice.link"
        class="flex items-start gap-2 rounded px-2 py-2 text-sm hover:bg-slate-50"
        @click="open = false"
      >
        <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" :class="COLORS[notice.kind]" />
        {{ notice.text }}
      </RouterLink>
      <p v-if="!notices.length" class="px-2 py-2 text-sm text-slate-500">{{ t('alerts.none') }}</p>
    </div>
  </div>
</template>

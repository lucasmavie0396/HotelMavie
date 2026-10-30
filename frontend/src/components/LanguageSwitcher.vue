<script setup lang="ts">
import { LOCALES, locale, setLocale } from '@/i18n';

defineProps<{ dark?: boolean }>();
</script>

<template>
  <div class="flex rounded-lg p-0.5 text-xs font-semibold" :class="dark ? 'bg-white/10' : 'bg-slate-100'" role="group" :aria-label="locale === 'en' ? 'Language' : 'Idioma'">
    <button
      v-for="item in LOCALES"
      :key="item.value"
      type="button"
      class="rounded-md px-2 py-1 transition"
      :class="
        locale === item.value ? (dark ? 'bg-white text-slate-900' : 'bg-white text-indigo-700 shadow') : dark ? 'text-white/80 hover:text-white' : 'text-slate-500 hover:text-slate-800'
      "
      :aria-pressed="locale === item.value"
      :title="item.name"
      @click="setLocale(item.value)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

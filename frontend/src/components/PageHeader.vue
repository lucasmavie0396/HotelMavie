<script setup lang="ts">
import { computed } from 'vue';
import { SECTIONS } from '@/utils/sections';

const props = defineProps<{ section: string; title?: string; subtitle?: string }>();
const meta = computed(() => SECTIONS[props.section] ?? SECTIONS.dashboard);
</script>

<template>
  <div class="page-header relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-lg" :class="meta.gradient">
    <div class="pointer-events-none absolute -top-14 -right-8 size-44 rounded-full bg-white/10" />
    <div class="pointer-events-none absolute -bottom-16 right-36 size-32 rounded-full bg-white/10" />
    <div class="relative flex flex-wrap items-center justify-between gap-4">
      <div class="flex min-w-0 items-center gap-3">
        <span class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/20 shadow-inner backdrop-blur">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path :d="meta.icon" />
          </svg>
        </span>
        <div class="min-w-0">
          <h1 class="flex flex-wrap items-center gap-3 text-2xl font-semibold">
            <slot name="title">{{ title ?? meta.label }}</slot>
          </h1>
          <p v-if="subtitle || $slots.subtitle" class="mt-0.5 text-sm text-white/80">
            <slot name="subtitle">{{ subtitle }}</slot>
          </p>
        </div>
      </div>
      <div v-if="$slots.default" class="flex flex-wrap items-center gap-2">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

const props = withDefaults(defineProps<{ segments: DonutSegment[]; center?: string; caption?: string; description: string }>(), {
  center: undefined,
  caption: '',
});
const emit = defineEmits<{ select: [key: string] }>();

const RADIUS = 60;
const STROKE = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const hover = ref<string | null>(null);

const total = computed(() => props.segments.reduce((sum, item) => sum + item.value, 0));
const arcs = computed(() => {
  let offset = 0;
  return props.segments
    .filter((item) => item.value > 0)
    .map((item) => {
      const length = (item.value / total.value) * CIRCUMFERENCE;
      const arc = { ...item, dash: `${Math.max(length - 2, 0.5)} ${CIRCUMFERENCE}`, offset: -offset };
      offset += length;
      return arc;
    });
});
const active = computed(() => props.segments.find((item) => item.key === hover.value) ?? null);
const percent = (value: number) => (total.value ? Math.round((value / total.value) * 100) : 0);
</script>

<template>
  <div class="flex flex-wrap items-center gap-6">
    <svg viewBox="0 0 160 160" class="size-40 shrink-0" role="img" :aria-label="description">
      <circle cx="80" cy="80" :r="RADIUS" fill="none" stroke="currentColor" class="text-slate-100" :stroke-width="STROKE" />
      <g transform="rotate(-90 80 80)">
      <circle
        v-for="arc in arcs"
        :key="arc.key"
        cx="80"
        cy="80"
        :r="RADIUS"
        fill="none"
        :stroke="arc.color"
        :stroke-width="hover === arc.key ? STROKE + 6 : STROKE"
        :stroke-dasharray="arc.dash"
        :stroke-dashoffset="arc.offset"
        class="cursor-pointer transition-[stroke-width]"
        role="button"
        tabindex="0"
        :aria-label="`${arc.label}: ${arc.value}`"
        @mouseenter="hover = arc.key"
        @mouseleave="hover = null"
        @focus="hover = arc.key"
        @blur="hover = null"
        @click="emit('select', arc.key)"
        @keydown.enter="emit('select', arc.key)"
      />
      </g>
      <text x="80" y="82" text-anchor="middle" class="fill-slate-900 text-[22px] font-semibold">{{ active ? active.value : (center ?? total) }}</text>
      <text x="80" y="100" text-anchor="middle" class="fill-slate-500 text-[10px]">{{ active ? `${percent(active.value)}%` : caption }}</text>
    </svg>
    <ul class="min-w-36 flex-1 space-y-1.5 text-sm">
      <li v-for="item in segments" :key="item.key">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-slate-50"
          :class="hover === item.key ? 'bg-slate-50' : ''"
          @mouseenter="hover = item.key"
          @mouseleave="hover = null"
          @click="emit('select', item.key)"
        >
          <span class="inline-block size-2.5 shrink-0 rounded-full" :style="{ background: item.color }" />
          <span class="flex-1 text-slate-700">{{ item.label }}</span>
          <span class="font-medium tabular-nums">{{ item.value }}</span>
          <span class="w-10 text-right text-xs text-slate-500 tabular-nums">{{ percent(item.value) }}%</span>
        </button>
      </li>
    </ul>
  </div>
</template>

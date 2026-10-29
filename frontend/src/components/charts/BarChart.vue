<script setup lang="ts">
import { computed, ref } from 'vue';

export interface BarSeries {
  name: string;
  color: string;
  values: number[];
}

const props = withDefaults(
  defineProps<{
    labels: string[];
    series: BarSeries[];
    format?: (value: number) => string;
    height?: number;
    max?: number;
    highlight?: number;
    description: string;
  }>(),
  { format: (value: number) => String(value), height: 220, max: undefined, highlight: -1 },
);
const emit = defineEmits<{ select: [index: number] }>();

const WIDTH = 640;
const PAD = { top: 12, right: 8, bottom: 28, left: 52 };
const hover = ref(-1);

const totals = computed(() => props.labels.map((_, index) => props.series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0)));
const top = computed(() => {
  const peak = Math.max(props.max ?? 0, ...totals.value, 1);
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value * 4 >= peak) ?? magnitude * 10;
  return step * 4;
});
const ticks = computed(() => [0, 1, 2, 3, 4].map((index) => (top.value / 4) * index));
const plotHeight = computed(() => props.height - PAD.top - PAD.bottom);
const slot = computed(() => (WIDTH - PAD.left - PAD.right) / Math.max(props.labels.length, 1));
const barWidth = computed(() => Math.min(36, slot.value * 0.62));
const y = (value: number) => PAD.top + plotHeight.value - (value / top.value) * plotHeight.value;

const bars = computed(() =>
  props.labels.map((label, index) => {
    let base = 0;
    const x = PAD.left + slot.value * index + (slot.value - barWidth.value) / 2;
    const segments = props.series.map((item) => {
      const value = item.values[index] ?? 0;
      const segment = { color: item.color, name: item.name, value, y: y(base + value), height: (value / top.value) * plotHeight.value };
      base += value;
      return segment;
    });
    return { label, index, x, segments, total: totals.value[index] };
  }),
);
const labelEvery = computed(() => Math.ceil(props.labels.length / 10));
const tooltip = computed(() => (hover.value >= 0 ? bars.value[hover.value] : null));
</script>

<template>
  <div class="relative">
    <svg :viewBox="`0 0 ${WIDTH} ${height}`" class="h-auto w-full" role="img" :aria-label="description" @mouseleave="hover = -1">
      <g v-for="tick in ticks" :key="tick">
        <line :x1="PAD.left" :x2="WIDTH - PAD.right" :y1="y(tick)" :y2="y(tick)" stroke="currentColor" class="text-slate-200" stroke-width="1" />
        <text :x="PAD.left - 8" :y="y(tick) + 4" text-anchor="end" class="fill-slate-500 text-[11px]">{{ format(tick) }}</text>
      </g>
      <g
        v-for="bar in bars"
        :key="bar.label"
        class="cursor-pointer"
        role="button"
        tabindex="0"
        :aria-label="`${bar.label}: ${format(bar.total)}`"
        @mouseenter="hover = bar.index"
        @focus="hover = bar.index"
        @click="emit('select', bar.index)"
        @keydown.enter="emit('select', bar.index)"
      >
        <rect :x="PAD.left + slot * bar.index" :y="PAD.top" :width="slot" :height="plotHeight" :class="hover === bar.index ? 'fill-slate-100' : 'fill-transparent'" />
        <rect
          v-for="(segment, position) in bar.segments"
          :key="segment.name"
          :x="bar.x"
          :y="segment.y"
          :width="barWidth"
          :height="Math.max(segment.height, segment.value > 0 ? 1.5 : 0)"
          :fill="segment.color"
          :rx="position === bar.segments.length - 1 || bar.segments.slice(position + 1).every((next) => next.value === 0) ? 4 : 0"
          :opacity="highlight >= 0 && highlight !== bar.index ? 0.55 : 1"
        />
        <text
          v-if="bar.index % labelEvery === 0"
          :x="bar.x + barWidth / 2"
          :y="height - 8"
          text-anchor="middle"
          class="text-[11px]"
          :class="highlight === bar.index ? 'fill-slate-900 font-semibold' : 'fill-slate-500'"
        >
          {{ bar.label }}
        </text>
      </g>
    </svg>
    <div
      v-if="tooltip"
      class="pointer-events-none absolute top-0 rounded-md bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
      :style="{ left: `${Math.min(((tooltip.x + barWidth) / WIDTH) * 100, 70)}%` }"
    >
      <p class="font-semibold">{{ tooltip.label }} · {{ format(tooltip.total) }}</p>
      <p v-for="segment in tooltip.segments.filter((item) => item.value > 0)" :key="segment.name" class="flex items-center gap-1.5">
        <span class="inline-block size-2 rounded-full" :style="{ background: segment.color }" />{{ segment.name }}: {{ format(segment.value) }}
      </p>
    </div>
    <ul v-if="series.length > 1" class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      <li v-for="item in series" :key="item.name" class="flex items-center gap-1.5">
        <span class="inline-block size-2.5 rounded-sm" :style="{ background: item.color }" />{{ item.name }}
      </li>
    </ul>
  </div>
</template>

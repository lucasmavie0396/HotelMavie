<script setup lang="ts">
import { errorMessage } from '@/services/api';
import { previewPdfFrom } from '@/services/print';
import type { PaperWidth } from '@/types';

const props = withDefaults(defineProps<{ path?: string; params?: Record<string, unknown>; title: string }>(), { path: '/print/pdf', params: () => ({}) });
const emit = defineEmits<{ error: [message: string] }>();

const PAPERS: { paper: PaperWidth; label: string }[] = [
  { paper: 'MM80', label: '80 mm' },
  { paper: 'A4', label: 'A4' },
];

function show(paper: PaperWidth, label: string) {
  previewPdfFrom(props.path, { ...props.params, paper }, `${props.title} · ${label}`, paper).catch((e) => emit('error', errorMessage(e)));
}
</script>

<template>
  <span class="inline-flex gap-2 text-xs">
    <button v-for="item in PAPERS" :key="item.paper" class="text-indigo-600 hover:underline" type="button" @click="show(item.paper, item.label)">{{ item.label }}</button>
  </span>
</template>

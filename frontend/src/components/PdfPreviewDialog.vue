<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { closePdf, pdfPreview } from '@/services/print';

const frame = ref<HTMLIFrameElement | null>(null);
const narrow = computed(() => pdfPreview.paper !== 'A4');
const fileName = computed(() => `${pdfPreview.title.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').toLowerCase() || 'documento'}.pdf`);

function print() {
  try {
    frame.value?.contentWindow?.focus();
    frame.value?.contentWindow?.print();
  } catch {
    window.open(pdfPreview.url, '_blank');
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && pdfPreview.url) closePdf();
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  closePdf();
});
</script>

<template>
  <div v-if="pdfPreview.url" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" @click.self="closePdf">
    <div
      class="flex h-[90dvh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      :class="narrow ? 'max-w-lg' : 'max-w-4xl'"
      role="dialog"
      aria-modal="true"
      :aria-label="pdfPreview.title"
    >
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div class="min-w-0">
          <p class="truncate font-semibold">{{ pdfPreview.title }}</p>
          <p class="text-xs text-slate-500">{{ narrow ? `Talao ${pdfPreview.paper === 'MM58' ? '58' : '80'} mm` : 'Folha A4' }} · pre-visualizacao</p>
        </div>
        <div class="flex gap-2">
          <button class="btn" type="button" @click="print">Imprimir</button>
          <a class="btn-secondary" :href="pdfPreview.url" :download="fileName">Descarregar</a>
          <button class="btn-secondary" type="button" @click="closePdf">Fechar</button>
        </div>
      </div>
      <iframe ref="frame" :src="pdfPreview.url" class="min-h-0 flex-1 bg-slate-100" :title="pdfPreview.title" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { closePdf, pdfPreview, showPdfAt } from '@/services/print';

const { t } = useI18n();
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
  if (!pdfPreview.url) return;
  if (event.key === 'Escape') closePdf();
  if (event.key === 'ArrowRight') showPdfAt(pdfPreview.index + 1);
  if (event.key === 'ArrowLeft') showPdfAt(pdfPreview.index - 1);
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
          <p class="text-xs text-slate-500">{{ narrow ? t('pdf.receipt', { mm: pdfPreview.paper === 'MM58' ? '58' : '80' }) : t('pdf.a4') }} · {{ t('pdf.preview') }}</p>
        </div>
        <div v-if="pdfPreview.queue.length > 1" class="flex items-center gap-1 text-sm">
          <button class="btn-secondary px-2" type="button" :disabled="pdfPreview.index === 0" :aria-label="t('pdf.previous')" @click="showPdfAt(pdfPreview.index - 1)">&lsaquo;</button>
          <span class="px-1 whitespace-nowrap text-slate-600">{{ t('pdf.of', { index: pdfPreview.index + 1, count: pdfPreview.queue.length }) }}</span>
          <button
            class="btn-secondary px-2"
            type="button"
            :disabled="pdfPreview.index === pdfPreview.queue.length - 1"
            :aria-label="t('pdf.next')"
            @click="showPdfAt(pdfPreview.index + 1)"
          >
            &rsaquo;
          </button>
        </div>
        <div class="flex gap-2">
          <button class="btn" type="button" @click="print">{{ t('common.print') }}</button>
          <a class="btn-secondary" :href="pdfPreview.url" :download="fileName">{{ t('common.download') }}</a>
          <button class="btn-secondary" type="button" @click="closePdf">{{ t('common.close') }}</button>
        </div>
      </div>
      <iframe ref="frame" :src="pdfPreview.url" class="min-h-0 flex-1 bg-slate-100" :title="pdfPreview.title" />
    </div>
  </div>
</template>

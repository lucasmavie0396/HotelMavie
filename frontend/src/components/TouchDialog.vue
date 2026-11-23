<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dialogState, finishDialog } from '@/services/dialog';

const { t } = useI18n();
const field = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
const invalid = computed(() => Boolean(dialogState.request.required && !dialogState.value.trim()));

watch(
  () => dialogState.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    field.value?.focus();
  },
);

function confirm() {
  if (invalid.value) return;
  finishDialog(dialogState.request.input ? dialogState.value.trim() : '');
}
</script>

<template>
  <div
    v-if="dialogState.open"
    class="fixed inset-x-0 top-0 z-[900] flex items-center justify-center bg-slate-900/50 p-4"
    :style="{ bottom: 'var(--keyboard-height, 0px)' }"
    @keydown.esc="finishDialog(null)"
  >
    <form role="dialog" aria-modal="true" :aria-label="dialogState.request.title" class="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl" @submit.prevent="confirm">
      <h2 class="text-lg font-semibold text-slate-900">{{ dialogState.request.title }}</h2>
      <p v-if="dialogState.request.message" class="text-sm text-slate-600">{{ dialogState.request.message }}</p>
      <textarea
        v-if="dialogState.request.input === 'textarea'"
        ref="field"
        v-model="dialogState.value"
        class="input min-h-24"
        rows="3"
        maxlength="255"
      />
      <input v-else-if="dialogState.request.input === 'text'" ref="field" v-model="dialogState.value" class="input" maxlength="200" />
      <p v-if="dialogState.request.required && invalid" class="text-xs text-slate-500">{{ t('dialog.required') }}</p>
      <div class="grid grid-cols-2 gap-2">
        <button class="btn-secondary min-h-12 text-base" type="button" @click="finishDialog(null)">{{ t('common.cancel') }}</button>
        <button
          class="btn min-h-12 text-base"
          :class="dialogState.request.danger ? 'from-rose-600 to-rose-600' : ''"
          type="submit"
          :disabled="invalid"
        >
          {{ dialogState.request.confirmLabel ?? t('common.confirm') }}
        </button>
      </div>
    </form>
  </div>
</template>

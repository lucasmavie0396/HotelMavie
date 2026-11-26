<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, downloadFile, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';

interface ImportCheck {
  total: number;
  withErrors: number;
  toCreate: number;
  toUpdate: number;
  newCategories: string[];
  rows: { line: number; sku: string; name: string; category: string; action: 'CREATE' | 'UPDATE'; errors: string[] }[];
}

const emit = defineEmits<{ imported: [] }>();
const { t } = useI18n();
const hotels = useHotelsStore();
const open = ref(false);
const file = ref<{ name: string; data: string } | null>(null);
const check = ref<ImportCheck | null>(null);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const onlyErrors = ref(true);
const shown = computed(() => (check.value ? check.value.rows.filter((row) => !onlyErrors.value || row.errors.length) : []));

async function run(action: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const exportProducts = () => run(() => downloadFile('/products/export.xlsx', { hotelId: hotels.selectedId }, 'produtos.xlsx'));
const template = () => run(() => downloadFile('/products/import-template.xlsx', undefined, 'modelo-importacao-produtos.xlsx'));

function pick(event: Event) {
  const input = event.target as HTMLInputElement;
  const chosen = input.files?.[0];
  input.value = '';
  check.value = null;
  notice.value = '';
  if (!chosen) return;
  if (chosen.size > 8 * 1024 * 1024) {
    error.value = t('productsExcel.tooBig');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    file.value = { name: chosen.name, data: String(reader.result) };
    verify();
  };
  reader.onerror = () => (error.value = t('productsExcel.readError'));
  reader.readAsDataURL(chosen);
}

const verify = () =>
  run(async () => {
    if (!file.value) return;
    check.value = (await api.post<ImportCheck>('/products/import/check', { hotelId: hotels.selectedId, file: file.value.data })).data;
    onlyErrors.value = check.value.withErrors > 0;
  });

const apply = () =>
  run(async () => {
    if (!file.value) return;
    const { data } = await api.post<{ created: number; updated: number; newCategories: string[] }>('/products/import', { hotelId: hotels.selectedId, file: file.value.data });
    notice.value = t('productsExcel.done', { created: data.created, updated: data.updated, categories: data.newCategories.length });
    check.value = null;
    file.value = null;
    emit('imported');
  });
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap gap-2">
      <button class="btn-secondary" type="button" :disabled="busy" @click="exportProducts">{{ t('productsExcel.export') }}</button>
      <button class="btn-secondary" type="button" :aria-expanded="open" @click="open = !open">{{ t('productsExcel.import') }}</button>
    </div>
    <p v-if="notice" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{{ notice }}</p>
    <p v-if="error && !open" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>

    <section v-if="open" class="card space-y-3" data-testid="products-import">
      <h2 class="font-semibold">{{ t('productsExcel.importTitle') }}</h2>
      <p class="text-sm text-slate-600">{{ t('productsExcel.importHint') }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn-secondary" type="button" :disabled="busy" @click="template">{{ t('productsExcel.template') }}</button>
        <label class="btn cursor-pointer" :class="busy ? 'pointer-events-none opacity-60' : ''">
          {{ t('productsExcel.choose') }}
          <input class="hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-testid="products-file" @change="pick" />
        </label>
        <span v-if="file" class="text-sm text-slate-600">{{ file.name }}</span>
      </div>
      <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>

      <template v-if="check">
        <p class="text-sm" :class="check.withErrors ? 'text-rose-700' : 'text-emerald-700'">
          {{ check.withErrors ? t('productsExcel.withErrors', { n: check.withErrors, total: check.total }) : t('productsExcel.ready', { create: check.toCreate, update: check.toUpdate }) }}
          <template v-if="check.newCategories.length"> · {{ t('productsExcel.newCategories', { names: check.newCategories.join(', ') }) }}</template>
        </p>
        <label v-if="check.withErrors" class="flex items-center gap-2 text-sm"><input v-model="onlyErrors" type="checkbox" />{{ t('productsExcel.onlyErrors') }}</label>
        <div class="max-h-80 overflow-auto">
          <table class="w-full text-left text-sm">
            <thead class="sticky top-0 bg-white text-slate-600">
              <tr>
                <th class="py-1 pr-2">{{ t('productsExcel.line') }}</th>
                <th class="py-1 pr-2">{{ t('products.code') }}</th>
                <th class="py-1 pr-2">{{ t('common.name') }}</th>
                <th class="py-1 pr-2">{{ t('products.category') }}</th>
                <th class="py-1 pr-2">{{ t('productsExcel.action') }}</th>
                <th class="py-1">{{ t('productsExcel.errors') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in shown" :key="row.line" class="border-t border-slate-100 align-top">
                <td class="py-1 pr-2 tabular-nums">{{ row.line }}</td>
                <td class="py-1 pr-2">{{ row.sku || '-' }}</td>
                <td class="py-1 pr-2">{{ row.name || '-' }}</td>
                <td class="py-1 pr-2">{{ row.category || '-' }}</td>
                <td class="py-1 pr-2">{{ row.action === 'CREATE' ? t('productsExcel.create') : t('productsExcel.update') }}</td>
                <td class="py-1 text-rose-700">{{ row.errors.join('; ') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" type="button" :disabled="busy" @click="verify">{{ t('productsExcel.verify') }}</button>
          <button class="btn" type="button" :disabled="busy || check.withErrors > 0" @click="apply">{{ t('productsExcel.apply', { n: check.total }) }}</button>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import ReportPreview from '@/components/ReportPreview.vue';
import { api, errorMessage, openPdf } from '@/services/api';
import { previewPdfFrom, printDocument, printPdfFrom } from '@/services/print';
import { useHotelsStore } from '@/stores/hotels';
import type { ReportDefinition, ReportDocument, Warehouse } from '@/types';
import { addDays, todayIso } from '@/utils/format';

const GROUP_STYLES: Record<string, { color: string; icon: string }> = {
  Operacao: { color: 'from-sky-500 to-indigo-500', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z' },
  Gestao: { color: 'from-fuchsia-500 to-purple-600', icon: 'M18 20V10M12 20V4M6 20v-6' },
  Financeiro: { color: 'from-emerald-500 to-teal-600', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8' },
  'Restauracao e stocks': { color: 'from-amber-500 to-orange-600', icon: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z' },
};

const route = useRoute();
const hotels = useHotelsStore();
const catalog = ref<ReportDefinition[]>([]);
const warehouses = ref<Warehouse[]>([]);
const selectedKey = ref('');
const report = ref<ReportDocument | null>(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const params = reactive({
  from: isDate(route.query.de) ? route.query.de : addDays(todayIso(), -30),
  to: isDate(route.query.ate) ? route.query.ate : todayIso(),
  date: isDate(route.query.data) ? route.query.data : isDate(route.query.de) && route.query.de === route.query.ate ? route.query.de : todayIso(),
  warehouseId: 0,
});

const selected = computed(() => catalog.value.find((item) => item.key === selectedKey.value) ?? null);
const groups = computed(() => {
  const map = new Map<string, ReportDefinition[]>();
  for (const item of catalog.value) map.set(item.group, [...(map.get(item.group) ?? []), item]);
  return [...map.entries()];
});

function query() {
  const kind = selected.value?.params;
  return {
    hotelId: hotels.selectedId,
    ...(kind === 'period' ? { from: params.from, to: params.to } : {}),
    ...(kind === 'date' ? { date: params.date } : {}),
    ...(kind === 'stock' && params.warehouseId ? { warehouseId: params.warehouseId } : {}),
  };
}

async function run(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const view = () =>
  run(async () => {
    report.value = (await api.get<ReportDocument>(`/reports/view/${selectedKey.value}`, { params: query() })).data;
  });

const openA4 = () => run(() => openPdf(`/reports/view/${selectedKey.value}/pdf`, { ...query(), paper: 'A4' }));
const printA4 = () => run(() => printPdfFrom(`/reports/view/${selectedKey.value}/pdf`, { ...query(), paper: 'A4' }));
const preview80 = () =>
  run(() =>
    previewPdfFrom('/print/pdf', { document: 'REPORT', report: selectedKey.value, ...query(), paper: 'MM80' }, `${selected.value?.title ?? 'Relatorio'} · 80 mm`, 'MM80'),
  );
const print80 = () =>
  run(async () => {
    notice.value = await printDocument({ document: 'REPORT', report: selectedKey.value, ...query() });
  });

function exportCsv() {
  if (!report.value) return;
  const lines: string[][] = [[report.value.hotel.name], [report.value.title, report.value.period], []];
  for (const section of report.value.sections) {
    lines.push([section.title.toUpperCase()]);
    for (const kpi of section.kpis ?? []) lines.push([kpi.label, kpi.value]);
    if (section.table) {
      lines.push(section.table.columns.map((column) => column.label));
      lines.push(...section.table.rows);
      if (section.table.totals) lines.push(section.table.totals);
    }
    lines.push([]);
  }
  const csv = lines.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${report.value.key}-${todayIso()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function choose(key: string) {
  selectedKey.value = key;
  report.value = null;
  view();
}

watch(
  () => params.from,
  (from) => {
    if (params.to < from) params.to = from;
  },
);

onMounted(() =>
  run(async () => {
    catalog.value = (await api.get<ReportDefinition[]>('/reports/catalog')).data;
    if (catalog.value.some((item) => item.params === 'stock')) {
      warehouses.value = (await api.get<Warehouse[]>('/warehouses', { params: { hotelId: hotels.selectedId } })).data;
    }
    const wanted = typeof route.query.relatorio === 'string' ? route.query.relatorio : isDate(route.query.de) ? (route.query.de === route.query.ate ? 'daily' : 'management') : '';
    const initial = catalog.value.find((item) => item.key === wanted) ?? catalog.value[0];
    if (initial) choose(initial.key);
  }),
);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="reports" subtitle="Escolhe o relatorio, ve no ecra e imprime em A4 ou em talao de 80 mm" />

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <div class="grid gap-6 xl:grid-cols-[300px_1fr]">
      <aside class="space-y-5">
        <div v-for="[group, items] in groups" :key="group" class="space-y-2">
          <p class="flex items-center gap-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">
            <span class="flex size-6 items-center justify-center rounded-md bg-gradient-to-br text-white" :class="GROUP_STYLES[group]?.color ?? 'from-slate-500 to-slate-700'">
              <svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path :d="GROUP_STYLES[group]?.icon ?? GROUP_STYLES.Gestao.icon" />
              </svg>
            </span>
            {{ group }}
          </p>
          <button
            v-for="item in items"
            :key="item.key"
            type="button"
            class="w-full rounded-xl border px-3 py-2.5 text-left transition"
            :class="selectedKey === item.key ? 'border-indigo-300 bg-indigo-50 shadow-sm ring-2 ring-indigo-500/30' : 'border-slate-100 bg-white hover:border-indigo-200 hover:bg-indigo-50/50'"
            @click="choose(item.key)"
          >
            <span class="block text-sm font-semibold text-slate-900">{{ item.title }}</span>
            <span class="block text-xs text-slate-500">{{ item.description }}</span>
          </button>
        </div>
      </aside>

      <div v-if="selected" class="min-w-0 space-y-4">
        <form class="card flex flex-wrap items-end gap-3" @submit.prevent="view">
          <template v-if="selected.params === 'period'">
            <label class="text-sm">De<input v-model="params.from" class="input mt-1 w-auto" type="date" required /></label>
            <label class="text-sm">Ate<input v-model="params.to" class="input mt-1 w-auto" type="date" :min="params.from" required /></label>
            <div class="flex flex-wrap gap-1 pb-0.5">
              <button
                v-for="preset in [
                  { label: 'Hoje', from: todayIso(), to: todayIso() },
                  { label: '7 dias', from: addDays(todayIso(), -6), to: todayIso() },
                  { label: 'Este mes', from: `${todayIso().slice(0, 8)}01`, to: todayIso() },
                  { label: '30 dias', from: addDays(todayIso(), -29), to: todayIso() },
                ]"
                :key="preset.label"
                type="button"
                class="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
                @click="Object.assign(params, { from: preset.from, to: preset.to }); view()"
              >
                {{ preset.label }}
              </button>
            </div>
          </template>
          <label v-else-if="selected.params === 'date'" class="text-sm">Dia<input v-model="params.date" class="input mt-1 w-auto" type="date" required /></label>
          <label v-else-if="selected.params === 'stock'" class="text-sm">
            Armazem
            <select v-model.number="params.warehouseId" class="input mt-1 w-auto">
              <option :value="0">Todos os armazens</option>
              <option v-for="warehouse in warehouses" :key="warehouse.id" :value="warehouse.id">{{ warehouse.name }}</option>
            </select>
          </label>
          <p v-else class="text-sm text-slate-500">Situacao a data de hoje.</p>
          <button class="btn" type="submit" :disabled="busy">{{ busy ? 'A gerar...' : 'Ver relatorio' }}</button>
          <div class="ml-auto flex flex-wrap gap-2">
            <button class="btn-secondary" type="button" :disabled="busy" @click="printA4">Imprimir A4</button>
            <button class="btn-secondary" type="button" :disabled="busy" @click="print80">Imprimir 80 mm</button>
            <button class="btn-secondary" type="button" :disabled="busy" @click="openA4">PDF A4</button>
            <button class="btn-secondary" type="button" :disabled="busy" @click="preview80">PDF 80 mm</button>
            <button class="btn-secondary" type="button" :disabled="!report" @click="exportCsv">CSV</button>
          </div>
        </form>

        <ReportPreview v-if="report" :report="report" />
        <p v-else-if="busy" class="py-10 text-center text-sm text-slate-500">A gerar o relatorio...</p>
      </div>
    </div>
  </section>
</template>

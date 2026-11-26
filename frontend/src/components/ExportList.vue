<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import { buildXlsx, type Cell } from '@/utils/xlsx';

const props = defineProps<{ title: string; columns: string[]; rows: () => Cell[][] | Promise<Cell[][]>; filters?: string }>();

const { t } = useI18n();
const hotels = useHotelsStore();
const busy = ref(false);
const error = ref('');

function fileName(extension: string) {
  const day = new Date().toLocaleDateString('en-CA');
  const base = props.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base || 'lista'}-${day}.${extension}`;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const csvCell = (value: Cell) => {
  const text = value === null || value === undefined ? '' : typeof value === 'number' ? String(value).replace('.', ',') : String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const html = (value: Cell) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

function printPdf(rows: Cell[][]) {
  const view = window.open('', '_blank', 'width=1000,height=700');
  if (!view) throw new Error(t('exportList.popup'));
  const number = (value: Cell) => (typeof value === 'number' ? value.toLocaleString('pt-PT', { maximumFractionDigits: 2 }) : html(value));
  view.document.write(`<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${html(props.title)}</title>
<style>body{font-family:Arial,sans-serif;font-size:11px;margin:16px;color:#0f172a}h1{font-size:16px;margin:0}p{margin:2px 0 10px;color:#475569}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eef2ff}
td.n{text-align:right;white-space:nowrap}@page{size:A4 landscape;margin:10mm}</style></head><body>
<h1>${html(props.title)}</h1><p>${html(hotels.selected?.name ?? '')} · ${new Date().toLocaleString('pt-PT')}${props.filters ? ` · ${html(props.filters)}` : ''} · ${rows.length} ${html(t('exportList.lines'))}</p>
<table><thead><tr>${props.columns.map((column) => `<th>${html(column)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((row) => `<tr>${row.map((value) => `<td${typeof value === 'number' ? ' class="n"' : ''}>${number(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<script>window.onload=function(){window.print()}<\/script></body></html>`);
  view.document.close();
}

async function run(format: 'xlsx' | 'csv' | 'pdf') {
  busy.value = true;
  error.value = '';
  try {
    const rows = await props.rows();
    if (format === 'xlsx') {
      save(new Blob([buildXlsx(props.columns, rows, props.title) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName('xlsx'));
    } else if (format === 'csv') {
      const content = [props.columns, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
      save(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' }), fileName('csv'));
    } else {
      printPdf(rows);
    }
    await api.post('/exports', { hotelId: hotels.selectedId ?? undefined, list: props.title.slice(0, 80), format, rows: rows.length, filters: props.filters?.slice(0, 300) }).catch(() => undefined);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="inline-flex flex-wrap items-center gap-1" role="group" :aria-label="t('exportList.label')" data-testid="export-list">
    <span class="text-xs text-slate-500">{{ t('exportList.label') }}</span>
    <button class="rounded-lg bg-white px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50" type="button" :disabled="busy" @click="run('xlsx')">Excel</button>
    <button class="rounded-lg bg-white px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50" type="button" :disabled="busy" @click="run('csv')">CSV</button>
    <button class="rounded-lg bg-white px-2 py-1 text-xs font-medium text-rose-700 ring-1 ring-slate-200 hover:bg-rose-50" type="button" :disabled="busy" @click="run('pdf')">PDF</button>
    <span v-if="error" class="text-xs text-rose-600">{{ error }}</span>
  </div>
</template>

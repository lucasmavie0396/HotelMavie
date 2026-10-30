<script setup lang="ts">
import { computed } from 'vue';
import { fileUrl } from '@/services/files';
import type { ReportDocument } from '@/types';

const props = defineProps<{ report: ReportDocument }>();
const hotel = computed(() => props.report.hotel);
const place = computed(() => [hotel.value.address, [hotel.value.postalCode, hotel.value.city].filter(Boolean).join(' ')].filter(Boolean).join(', '));
</script>

<template>
  <article class="mx-auto max-w-4xl rounded-2xl bg-white p-6 shadow-lg ring-1 ring-slate-200 sm:p-8">
    <header class="flex flex-wrap items-start justify-between gap-4 border-b-2 border-indigo-600 pb-4">
      <div class="flex items-start gap-4">
        <img v-if="hotel.logoFile" :src="fileUrl(hotel.logoFile)" :alt="hotel.name" class="max-h-16 max-w-32 object-contain" />
        <div class="text-xs leading-relaxed text-slate-600">
          <p class="text-base font-bold text-slate-900">{{ hotel.name }}</p>
          <p v-if="hotel.legalName && hotel.legalName !== hotel.name">{{ hotel.legalName }}</p>
          <p v-if="hotel.taxId">NIF: {{ hotel.taxId }}</p>
          <p v-if="place">{{ place }}</p>
          <p>{{ [hotel.phone, hotel.email].filter(Boolean).join(' · ') }}</p>
        </div>
      </div>
      <div class="text-right">
        <h2 class="text-xl font-bold tracking-tight text-indigo-700 uppercase">{{ report.title }}</h2>
        <p class="text-sm text-slate-800">{{ report.period }}</p>
        <p class="text-xs text-slate-500">Emitido em {{ report.generatedAt }} por {{ report.generatedBy }}</p>
      </div>
    </header>

    <section v-for="section in report.sections" :key="section.title" class="mt-6 space-y-3">
      <h3 class="text-sm font-bold tracking-wide text-indigo-700 uppercase">{{ section.title }}</h3>
      <div v-if="section.kpis?.length" class="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div v-for="kpi in section.kpis" :key="kpi.label" class="rounded-lg border-l-4 border-indigo-600 bg-indigo-50 px-3 py-2">
          <p class="truncate text-[11px] tracking-wide text-slate-500 uppercase">{{ kpi.label }}</p>
          <p class="truncate text-lg font-bold text-slate-900">{{ kpi.value }}</p>
        </div>
      </div>
      <template v-if="section.table">
        <p v-if="!section.table.rows.length" class="text-sm text-slate-500 italic">{{ section.table.empty ?? 'Sem dados' }}</p>
        <div v-else class="overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table class="w-full text-left text-xs">
            <thead class="bg-indigo-700 text-white">
              <tr>
                <th v-for="column in section.table.columns" :key="column.label" class="px-2.5 py-2 font-semibold whitespace-nowrap" :class="column.align === 'right' ? 'text-right' : ''">
                  {{ column.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in section.table.rows" :key="index" class="border-t border-slate-100 even:bg-slate-50">
                <td v-for="(cell, cellIndex) in row" :key="cellIndex" class="px-2.5 py-1.5" :class="section.table.columns[cellIndex]?.align === 'right' ? 'text-right whitespace-nowrap tabular-nums' : ''">
                  {{ cell }}
                </td>
              </tr>
            </tbody>
            <tfoot v-if="section.table.totals" class="bg-indigo-100 font-bold">
              <tr>
                <td v-for="(cell, cellIndex) in section.table.totals" :key="cellIndex" class="px-2.5 py-2" :class="section.table.columns[cellIndex]?.align === 'right' ? 'text-right whitespace-nowrap tabular-nums' : ''">
                  {{ cell }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </template>
      <p v-if="section.note" class="text-xs text-slate-500 italic">{{ section.note }}</p>
    </section>
  </article>
</template>

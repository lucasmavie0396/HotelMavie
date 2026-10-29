<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { ChargeType, InvoiceType, PaymentMethod, ReservationSource } from '@/types';
import {
  addDays,
  CHARGE_TYPE_LABELS,
  formatMoney,
  INVOICE_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  RESERVATION_SOURCE_LABELS,
  todayIso,
} from '@/utils/format';

interface Summary {
  period: { from: string; to: string; days: number };
  occupancy: { rooms: number; roomNightsAvailable: number; roomNightsSold: number; rate: number; roomRevenue: string; adr: string; revpar: string };
  revenueByType: { type: ChargeType; total: string }[];
  paymentsByMethod: { method: PaymentMethod; count: number; total: string }[];
  invoices: { type: InvoiceType; count: number; total: string; tax: string }[];
  topProducts: { productId: number; name: string; quantity: string; total: string }[];
  foodAndBeverage: { revenue: string; costOfSales: string; costPercent: number };
  reservationsBySource: { source: ReservationSource; count: number }[];
  cancellations: number;
}

const hotels = useHotelsStore();
const query = useRoute().query;
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const range = reactive({ from: isDate(query.de) ? query.de : addDays(todayIso(), -30), to: isDate(query.ate) ? query.ate : todayIso() });
const summary = ref<Summary | null>(null);
const error = ref('');

const money = (value: string | number) => formatMoney(value, hotels.currency);

async function load() {
  error.value = '';
  try {
    summary.value = (await api.get<Summary>('/reports/summary', { params: { hotelId: hotels.selectedId, ...range } })).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function exportCsv() {
  if (!summary.value) return;
  const s = summary.value;
  const rows: (string | number)[][] = [
    ['Periodo', s.period.from, s.period.to],
    [],
    ['Ocupacao %', s.occupancy.rate],
    ['Noites vendidas', s.occupancy.roomNightsSold],
    ['Noites disponiveis', s.occupancy.roomNightsAvailable],
    ['Receita de quartos', s.occupancy.roomRevenue],
    ['ADR', s.occupancy.adr],
    ['RevPAR', s.occupancy.revpar],
    [],
    ['Receita por tipo'],
    ...s.revenueByType.map((r) => [CHARGE_TYPE_LABELS[r.type], r.total]),
    [],
    ['Pagamentos por metodo'],
    ...s.paymentsByMethod.map((r) => [PAYMENT_METHOD_LABELS[r.method], r.count, r.total]),
    [],
    ['Documentos'],
    ...s.invoices.map((r) => [INVOICE_TYPE_LABELS[r.type], r.count, r.total, r.tax]),
    [],
    ['Restauracao: receita', s.foodAndBeverage.revenue],
    ['Restauracao: custo das vendas', s.foodAndBeverage.costOfSales],
    ['Food cost %', s.foodAndBeverage.costPercent],
    [],
    ['Produtos mais vendidos'],
    ...s.topProducts.map((r) => [r.name, r.quantity, r.total]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `relatorio-${s.period.from}-${s.period.to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="reports" subtitle="Ocupacao, receita, pagamentos e vendas">
      <form class="flex flex-wrap items-center gap-2" @submit.prevent="load">
        <input v-model="range.from" class="input w-auto" type="date" aria-label="De" required />
        <input v-model="range.to" class="input w-auto" type="date" aria-label="Ate" required />
        <button class="btn" type="submit">Atualizar</button>
        <button class="btn-secondary" type="button" :disabled="!summary" @click="exportCsv">Exportar CSV</button>
      </form>
    </PageHeader>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <template v-if="summary">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="card">
          <p class="text-sm text-slate-500">Ocupacao</p>
          <p class="text-3xl font-semibold">{{ summary.occupancy.rate }}%</p>
          <p class="text-xs text-slate-500">{{ summary.occupancy.roomNightsSold }} de {{ summary.occupancy.roomNightsAvailable }} noites</p>
        </div>
        <div class="card"><p class="text-sm text-slate-500">Receita de quartos</p><p class="text-2xl font-semibold">{{ money(summary.occupancy.roomRevenue) }}</p></div>
        <div class="card"><p class="text-sm text-slate-500">ADR (preco medio/noite)</p><p class="text-2xl font-semibold">{{ money(summary.occupancy.adr) }}</p></div>
        <div class="card"><p class="text-sm text-slate-500">RevPAR</p><p class="text-2xl font-semibold">{{ money(summary.occupancy.revpar) }}</p></div>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <div class="card space-y-2">
          <h2 class="font-semibold">Receita lancada por tipo</h2>
          <div v-for="row in summary.revenueByType" :key="row.type" class="flex justify-between text-sm">
            <span>{{ CHARGE_TYPE_LABELS[row.type] }}</span><span>{{ money(row.total) }}</span>
          </div>
          <p v-if="!summary.revenueByType.length" class="text-sm text-slate-500">Sem movimentos</p>
        </div>
        <div class="card space-y-2">
          <h2 class="font-semibold">Recebimentos por metodo</h2>
          <div v-for="row in summary.paymentsByMethod" :key="row.method" class="flex justify-between text-sm">
            <span>{{ PAYMENT_METHOD_LABELS[row.method] }} <span class="text-slate-500">({{ row.count }})</span></span><span>{{ money(row.total) }}</span>
          </div>
          <p v-if="!summary.paymentsByMethod.length" class="text-sm text-slate-500">Sem recebimentos</p>
        </div>
        <div class="card space-y-2">
          <h2 class="font-semibold">Documentos emitidos</h2>
          <div v-for="row in summary.invoices" :key="row.type" class="flex justify-between text-sm">
            <span>{{ INVOICE_TYPE_LABELS[row.type] }} <span class="text-slate-500">({{ row.count }})</span></span>
            <span>{{ money(row.total) }} <span class="text-slate-500">IVA {{ money(row.tax) }}</span></span>
          </div>
          <p v-if="!summary.invoices.length" class="text-sm text-slate-500">Sem documentos</p>
        </div>
        <div class="card space-y-2">
          <h2 class="font-semibold">Produtos mais vendidos</h2>
          <div v-for="row in summary.topProducts" :key="row.productId" class="flex justify-between text-sm">
            <span>{{ row.name }} <span class="text-slate-500">x{{ Number(row.quantity) }}</span></span><span>{{ money(row.total) }}</span>
          </div>
          <p v-if="!summary.topProducts.length" class="text-sm text-slate-500">Sem vendas</p>
        </div>
        <div class="card space-y-2">
          <h2 class="font-semibold">Restauracao e bar</h2>
          <div class="flex justify-between text-sm"><span>Receita</span><span>{{ money(summary.foodAndBeverage.revenue) }}</span></div>
          <div class="flex justify-between text-sm"><span>Custo das vendas (stock)</span><span>{{ money(summary.foodAndBeverage.costOfSales) }}</span></div>
          <div class="flex justify-between text-sm font-semibold">
            <span>Food cost</span>
            <span :class="summary.foodAndBeverage.costPercent > 35 ? 'text-rose-700' : 'text-emerald-700'">{{ summary.foodAndBeverage.costPercent }}%</span>
          </div>
        </div>
        <div class="card space-y-2">
          <h2 class="font-semibold">Reservas criadas por origem</h2>
          <div class="flex flex-wrap gap-6 text-sm">
            <span v-for="row in summary.reservationsBySource" :key="row.source">
              {{ RESERVATION_SOURCE_LABELS[row.source] }}: <strong>{{ row.count }}</strong>
            </span>
            <span class="text-rose-700">Cancelamentos/no-show: <strong>{{ summary.cancellations }}</strong></span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

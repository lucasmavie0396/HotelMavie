<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { AuditLog } from '@/types';
import { addDays, formatDateTime, todayIso } from '@/utils/format';

const hotels = useHotelsStore();
const logs = ref<AuditLog[]>([]);
const actions = ref<Record<string, string>>({});
const error = ref('');
const loading = ref(false);
const search = ref('');
const filters = reactive({ from: addDays(todayIso(), -30), to: todayIso(), action: '' });

const ACTION_CLASSES: Record<string, string> = {
  ORDER_ITEM_VOID: 'bg-rose-100 text-rose-800',
  ORDER_CANCEL: 'bg-rose-100 text-rose-800',
  PAYMENT_REFUND: 'bg-amber-100 text-amber-800',
  CREDIT_NOTE: 'bg-amber-100 text-amber-800',
  RECEIPT_CANCEL: 'bg-amber-100 text-amber-800',
  PRODUCT_PRICE: 'bg-sky-100 text-sky-800',
  AUTH_LOGIN_FAILED: 'bg-slate-200 text-slate-700',
};

const shown = computed(() => {
  const term = search.value.trim().toLowerCase();
  return term ? logs.value.filter((log) => `${log.summary} ${log.user?.name ?? ''}`.toLowerCase().includes(term)) : logs.value;
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [l, a] = await Promise.all([
      api.get<AuditLog[]>('/audit-logs', { params: { hotelId: hotels.selectedId, from: filters.from, to: filters.to, action: filters.action || undefined } }),
      Object.keys(actions.value).length ? Promise.resolve({ data: actions.value }) : api.get<Record<string, string>>('/audit-logs/actions'),
    ]);
    logs.value = l.data;
    actions.value = a.data;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="audit" subtitle="Quem alterou precos, anulou artigos, fez estornos, notas de credito e alteracoes de seguranca" />

    <form class="card flex flex-wrap items-end gap-3 text-sm" @submit.prevent="load">
      <label>De<input v-model="filters.from" class="input" type="date" required /></label>
      <label>Ate<input v-model="filters.to" class="input" type="date" required /></label>
      <label>
        Acao
        <select v-model="filters.action" class="input">
          <option value="">Todas</option>
          <option v-for="(label, key) in actions" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <button class="btn" type="submit" :disabled="loading">Filtrar</button>
      <input v-model="search" class="input ml-auto w-56" placeholder="Procurar no texto ou utilizador" />
    </form>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">Data</th>
            <th class="px-4 py-3">Acao</th>
            <th class="px-4 py-3">Detalhe</th>
            <th class="px-4 py-3">Utilizador</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in shown" :key="log.id" class="border-b border-slate-100 align-top">
            <td class="px-4 py-3 whitespace-nowrap">{{ formatDateTime(log.createdAt) }}</td>
            <td class="px-4 py-3">
              <span class="rounded-full px-2 py-0.5 text-xs whitespace-nowrap" :class="ACTION_CLASSES[log.action] ?? 'bg-indigo-100 text-indigo-800'">
                {{ actions[log.action] ?? log.action }}
              </span>
            </td>
            <td class="px-4 py-3">{{ log.summary }}</td>
            <td class="px-4 py-3 whitespace-nowrap text-slate-600">{{ log.user?.name ?? 'Sistema' }}</td>
          </tr>
          <tr v-if="!shown.length">
            <td colspan="4" class="px-4 py-6 text-center text-slate-500">{{ loading ? 'A carregar...' : 'Sem registos no periodo' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import ExportList from '@/components/ExportList.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { askText } from '@/services/dialog';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import { usePaymentTypesStore } from '@/stores/paymentTypes';
import type { Supplier } from '@/types';
import { addDays, formatDate, formatMoney, todayIso } from '@/utils/format';

interface Category {
  id: number;
  name: string;
  active: boolean;
}

interface Expense {
  id: number;
  description: string;
  amount: string;
  date: string;
  documentRef: string | null;
  status: 'CONFIRMED' | 'VOIDED';
  voidReason: string | null;
  cashMovementId: number | null;
  category: { id: number; name: string };
  supplier: { id: number; name: string } | null;
  paymentType: { id: number; name: string } | null;
  createdBy: { name: string } | null;
}

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const paymentTypes = usePaymentTypesStore();
const categories = ref<Category[]>([]);
const suppliers = ref<Supplier[]>([]);
const expenses = ref<Expense[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const newCategory = ref('');
const filters = reactive({ from: addDays(todayIso(), -30), to: todayIso(), categoryId: 0, status: '' as '' | 'CONFIRMED' | 'VOIDED' });
const form = reactive({ categoryId: 0, description: '', amount: 0, date: todayIso(), supplierId: 0, documentRef: '', paymentTypeId: 0 });
const isManager = computed(() => auth.isManager);
const types = computed(() => paymentTypes.active.filter((type) => !type.isEventCard));
const money = (value: string | number) => formatMoney(value, hotels.currency);
const total = computed(() => expenses.value.filter((expense) => expense.status === 'CONFIRMED').reduce((sum, expense) => sum + Number(expense.amount), 0));

async function load() {
  error.value = '';
  try {
    const params = { hotelId: hotels.selectedId };
    const [c, e] = await Promise.all([
      api.get<Category[]>('/expense-categories', { params }),
      api.get<Expense[]>('/expenses', { params: { ...params, from: filters.from || undefined, to: filters.to || undefined, categoryId: filters.categoryId || undefined, status: filters.status || undefined } }),
    ]);
    categories.value = c.data;
    expenses.value = e.data;
    if (!form.categoryId) form.categoryId = categories.value.find((category) => category.active)?.id ?? 0;
    await paymentTypes.load();
    if (isManager.value && !suppliers.value.length) {
      suppliers.value = (await api.get<Supplier[]>('/suppliers', { params }).catch(() => ({ data: [] as Supplier[] }))).data.filter((supplier) => supplier.active);
    }
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: () => Promise<unknown>, message: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    notice.value = message;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const addCategory = () =>
  run(async () => {
    const { data } = await api.post<Category>('/expense-categories', { hotelId: hotels.selectedId, name: newCategory.value });
    newCategory.value = '';
    form.categoryId = data.id;
  }, t('expenses.categoryCreated'));

const save = () =>
  run(async () => {
    await api.post('/expenses', {
      hotelId: hotels.selectedId,
      categoryId: form.categoryId,
      description: form.description,
      amount: form.amount,
      date: form.date,
      supplierId: form.supplierId || undefined,
      documentRef: form.documentRef || undefined,
      paymentTypeId: form.paymentTypeId || undefined,
    });
    Object.assign(form, { description: '', amount: 0, documentRef: '', supplierId: 0 });
  }, t('expenses.created'));

async function voidExpense(expense: Expense) {
  const reason = await askText({ title: t('expenses.voidTitle'), message: t('expenses.voidPrompt', { description: expense.description }), required: true, danger: true, confirmLabel: t('expenses.void') });
  if (!reason?.trim()) return;
  await run(() => api.post(`/expenses/${expense.id}/void`, { reason: reason.trim() }), t('expenses.voided'));
}

const exportColumns = () => [t('common.date'), t('expenses.category'), t('expenses.description'), t('expenses.supplier'), t('expenses.document'), t('expenses.payment'), t('expenses.amount'), t('common.status')];
const exportRows = () =>
  expenses.value.map((expense) => [
    formatDate(expense.date.slice(0, 10)),
    expense.category.name,
    expense.description,
    expense.supplier?.name ?? '',
    expense.documentRef ?? '',
    expense.paymentType?.name ?? '',
    Number(expense.amount),
    expense.status === 'VOIDED' ? t('expenses.voidedState') : '',
  ]);

onMounted(load);
</script>

<template>
  <section class="space-y-4">
    <PageHeader section="expenses" :subtitle="t('expenses.subtitle')" />

    <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
    <p v-if="notice" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{{ notice }}</p>

    <div class="grid gap-4 lg:grid-cols-3">
      <form class="card grid gap-3 sm:grid-cols-2 lg:col-span-2" data-testid="expense-form" @submit.prevent="save">
        <h2 class="font-semibold sm:col-span-2">{{ t('expenses.new') }}</h2>
        <label class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('expenses.category') }}</span>
          <select v-model.number="form.categoryId" class="input" required>
            <option v-for="category in categories.filter((item) => item.active)" :key="category.id" :value="category.id">{{ category.name }}</option>
          </select>
        </label>
        <label class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('common.date') }}</span>
          <input v-model="form.date" class="input" type="date" :max="todayIso()" required />
        </label>
        <label class="text-sm sm:col-span-2">
          <span class="mb-1 block text-slate-600">{{ t('expenses.description') }}</span>
          <input v-model="form.description" class="input" minlength="3" maxlength="200" required />
        </label>
        <label class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('expenses.amount') }}</span>
          <input v-model.number="form.amount" class="input" type="number" min="0.01" step="0.01" inputmode="decimal" required />
        </label>
        <label class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('expenses.payment') }}</span>
          <select v-model.number="form.paymentTypeId" class="input">
            <option :value="0">{{ t('expenses.notPaid') }}</option>
            <option v-for="type in types" :key="type.id" :value="type.id">{{ type.name }}{{ type.kind === 'CASH' ? ` (${t('expenses.fromCash')})` : '' }}</option>
          </select>
        </label>
        <label v-if="suppliers.length" class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('expenses.supplier') }}</span>
          <select v-model.number="form.supplierId" class="input">
            <option :value="0">-</option>
            <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">{{ supplier.name }}</option>
          </select>
        </label>
        <label class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('expenses.document') }}</span>
          <input v-model="form.documentRef" class="input" maxlength="60" />
        </label>
        <div class="flex justify-end sm:col-span-2">
          <button class="btn" type="submit" :disabled="busy || !form.categoryId">{{ t('expenses.save') }}</button>
        </div>
      </form>

      <div class="card space-y-3">
        <h2 class="font-semibold">{{ t('expenses.categories') }}</h2>
        <ul class="space-y-1 text-sm">
          <li v-for="category in categories" :key="category.id" :class="category.active ? '' : 'text-slate-400 line-through'">{{ category.name }}</li>
          <li v-if="!categories.length" class="text-slate-500">{{ t('expenses.noCategories') }}</li>
        </ul>
        <form v-if="isManager" class="flex gap-2" @submit.prevent="addCategory">
          <input v-model="newCategory" class="input" :placeholder="t('expenses.newCategory')" minlength="2" maxlength="80" required />
          <button class="btn-secondary" type="submit" :disabled="busy">{{ t('common.create') }}</button>
        </form>
      </div>
    </div>

    <div class="flex flex-wrap items-end justify-between gap-2">
      <form class="flex flex-wrap items-end gap-2 text-sm" @submit.prevent="load">
        <label>{{ t('cards.from') }} <input v-model="filters.from" class="input" type="date" /></label>
        <label>{{ t('cards.to') }} <input v-model="filters.to" class="input" type="date" /></label>
        <select v-model.number="filters.categoryId" class="input w-auto" :aria-label="t('expenses.category')">
          <option :value="0">{{ t('expenses.allCategories') }}</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
        </select>
        <select v-model="filters.status" class="input w-auto" :aria-label="t('common.status')">
          <option value="">{{ t('expenses.allStates') }}</option>
          <option value="CONFIRMED">{{ t('expenses.confirmedState') }}</option>
          <option value="VOIDED">{{ t('expenses.voidedState') }}</option>
        </select>
        <button class="btn-secondary" type="submit">{{ t('cards.searchButton') }}</button>
      </form>
      <ExportList :title="t('nav.expenses')" :columns="exportColumns()" :rows="exportRows" :filters="`${filters.from} - ${filters.to}`" />
    </div>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('common.date') }}</th>
            <th class="px-4 py-3">{{ t('expenses.category') }}</th>
            <th class="px-4 py-3">{{ t('expenses.description') }}</th>
            <th class="px-4 py-3">{{ t('expenses.payment') }}</th>
            <th class="px-4 py-3 text-right">{{ t('expenses.amount') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="expense in expenses" :key="expense.id" class="border-b border-slate-100" :class="expense.status === 'VOIDED' ? 'text-slate-400' : ''">
            <td class="px-4 py-3 whitespace-nowrap">{{ formatDate(expense.date.slice(0, 10)) }}</td>
            <td class="px-4 py-3">{{ expense.category.name }}</td>
            <td class="px-4 py-3">
              <span :class="expense.status === 'VOIDED' ? 'line-through' : ''">{{ expense.description }}</span>
              <span class="block text-xs text-slate-500">{{ [expense.supplier?.name, expense.documentRef, expense.createdBy?.name].filter(Boolean).join(' · ') }}</span>
              <span v-if="expense.voidReason" class="block text-xs text-rose-600">{{ t('expenses.voidedWith', { reason: expense.voidReason }) }}</span>
            </td>
            <td class="px-4 py-3">{{ expense.paymentType?.name ?? '-' }}</td>
            <td class="px-4 py-3 text-right tabular-nums">{{ money(expense.amount) }}</td>
            <td class="px-4 py-3 text-right">
              <button v-if="isManager && expense.status === 'CONFIRMED'" class="text-xs text-rose-600 hover:underline" type="button" :disabled="busy" @click="voidExpense(expense)">{{ t('expenses.void') }}</button>
            </td>
          </tr>
          <tr v-if="!expenses.length">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">{{ t('expenses.empty') }}</td>
          </tr>
        </tbody>
        <tfoot v-if="expenses.length" class="border-t border-slate-200 font-semibold">
          <tr>
            <td colspan="4" class="px-4 py-3">{{ t('common.total') }}</td>
            <td class="px-4 py-3 text-right tabular-nums">{{ money(total) }}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>

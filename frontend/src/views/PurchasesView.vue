<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { translated } from '@/i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import { previewPdfFrom } from '@/services/print';
import { askConfirm, askText } from '@/services/dialog';
import type { PaperWidth, Product, Purchase, PurchaseSuggestion, Supplier, TaxRate, Warehouse } from '@/types';
import { formatDate, formatDateTime, formatMoney } from '@/utils/format';

const STATUS_LABELS = translated<Purchase['status']>('purchases.statuses', ['DRAFT', 'PARTIAL', 'RECEIVED', 'CANCELLED']);
const STATUS_CLASSES: Record<Purchase['status'], string> = {
  DRAFT: 'bg-amber-100 text-amber-800',
  PARTIAL: 'bg-sky-100 text-sky-800',
  RECEIVED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const { t } = useI18n();
const hotels = useHotelsStore();
const tab = ref<'purchases' | 'suppliers'>('purchases');
const purchases = ref<Purchase[]>([]);
const suppliers = ref<Supplier[]>([]);
const warehouses = ref<Warehouse[]>([]);
const products = ref<Product[]>([]);
const taxRates = ref<TaxRate[]>([]);
const error = ref('');
const busy = ref(false);
const editingId = ref<number | null>(null);
const showForm = ref(false);

const supplier = reactive({ name: '', taxId: '', email: '', phone: '' });
const purchase = reactive({
  supplierId: 0,
  warehouseId: 0,
  supplierRef: '',
  documentDate: '',
  dueDate: '',
  notes: '',
  items: [] as PurchaseLine[],
});

interface PurchaseLine {
  productId: number;
  quantity: number;
  unitCost: number;
  discount: number;
  taxRate: number;
}

const notice = ref('');
const reception = ref<{
  purchase: Purchase;
  supplierRef: string;
  documentDate: string;
  dueDate: string;
  lines: { itemId: number; name: string; unit: string; remaining: number; quantity: number; trackExpiry: boolean; lot: string; expiryDate: string }[];
} | null>(null);
const suggest = reactive({
  open: false,
  warehouseId: 0,
  rows: [] as (PurchaseSuggestion & { selected: boolean; order: number; supplierId: number; cost: number })[],
});

const money = (value: string | number) => formatMoney(value, hotels.currency);
const qty = (value: string | number) => Number(value).toLocaleString('pt-PT', { maximumFractionDigits: 3 });
const purchaseNumber = (item: Purchase) => `ENC ${new Date(item.orderedAt).getUTCFullYear()}/${item.id}`;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const lineGross = (line: PurchaseLine) => round2((line.quantity || 0) * (line.unitCost || 0));
const lineTax = (line: PurchaseLine) => round2((lineGross(line) - (line.discount || 0)) * (line.taxRate || 0) / 100);
const lineTotal = (line: PurchaseLine) => round2(lineGross(line) - (line.discount || 0) + lineTax(line));
const draftTotals = computed(() => ({
  subtotal: round2(purchase.items.reduce((sum, line) => sum + lineGross(line), 0)),
  discount: round2(purchase.items.reduce((sum, line) => sum + (line.discount || 0), 0)),
  tax: round2(purchase.items.reduce((sum, line) => sum + lineTax(line), 0)),
  total: round2(purchase.items.reduce((sum, line) => sum + lineTotal(line), 0)),
}));
const today = () => new Date().toLocaleDateString('en-CA');
const productRate = (productId: number) => {
  const rateId = products.value.find((p) => p.id === productId)?.taxRateId;
  return Number(taxRates.value.find((rate) => rate.id === rateId)?.rate ?? 0);
};
const newLine = (product?: Product): PurchaseLine => ({
  productId: product?.id ?? 0,
  quantity: 1,
  unitCost: Number(product?.cost ?? 0),
  discount: 0,
  taxRate: product ? productRate(product.id) : 0,
});

async function load() {
  error.value = '';
  try {
    const params = { hotelId: hotels.selectedId };
    const [p, s, w, pr, tr] = await Promise.all([
      api.get<Purchase[]>('/purchases', { params }),
      api.get<Supplier[]>('/suppliers', { params }),
      api.get<Warehouse[]>('/warehouses', { params }),
      api.get<Product[]>('/products', { params }),
      api.get<TaxRate[]>('/tax-rates', { params }),
    ]);
    taxRates.value = tr.data;
    purchases.value = p.data;
    suppliers.value = s.data;
    warehouses.value = w.data;
    products.value = pr.data.filter((product) => product.trackStock && product.active);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function newPurchase() {
  editingId.value = null;
  Object.assign(purchase, {
    supplierId: suppliers.value.find((s) => s.active)?.id ?? 0,
    warehouseId: warehouses.value[0]?.id ?? 0,
    supplierRef: '',
    documentDate: '',
    dueDate: '',
    notes: '',
    items: [newLine(products.value[0])],
  });
  showForm.value = true;
}

function editPurchase(item: Purchase) {
  editingId.value = item.id;
  Object.assign(purchase, {
    supplierId: item.supplier.id,
    warehouseId: item.warehouse.id,
    supplierRef: item.supplierRef ?? '',
    documentDate: item.documentDate?.slice(0, 10) ?? '',
    dueDate: item.dueDate?.slice(0, 10) ?? '',
    notes: item.notes ?? '',
    items: item.items.map((line) => ({
      productId: line.productId,
      quantity: Number(line.quantity),
      unitCost: Number(line.unitCost),
      discount: Number(line.discount),
      taxRate: Number(line.taxRate),
    })),
  });
  showForm.value = true;
}

function onProductChange(line: PurchaseLine) {
  line.unitCost = Number(products.value.find((p) => p.id === line.productId)?.cost ?? 0);
  line.taxRate = productRate(line.productId);
}

const savePurchase = () =>
  run(async () => {
    const payload = {
      ...purchase,
      supplierRef: purchase.supplierRef || undefined,
      documentDate: purchase.documentDate || undefined,
      dueDate: purchase.dueDate || undefined,
      notes: purchase.notes || undefined,
    };
    if (editingId.value) {
      await api.patch(`/purchases/${editingId.value}`, payload);
    } else {
      await api.post('/purchases', payload);
    }
    showForm.value = false;
  });

function startReception(item: Purchase) {
  showForm.value = false;
  reception.value = {
    purchase: item,
    supplierRef: item.supplierRef ?? '',
    documentDate: item.documentDate?.slice(0, 10) ?? today(),
    dueDate: item.dueDate?.slice(0, 10) ?? '',
    lines: item.items
      .map((line) => {
        const remaining = Number(line.quantity) - Number(line.receivedQuantity);
        return {
          itemId: line.id,
          name: line.product.name,
          unit: line.product.unit,
          remaining,
          quantity: remaining,
          trackExpiry: line.product.trackExpiry,
          lot: '',
          expiryDate: '',
        };
      })
      .filter((line) => line.remaining > 0),
  };
}

const confirmReception = () =>
  run(async () => {
    if (!reception.value) return;
    const items = reception.value.lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      lot: line.trackExpiry && line.lot ? line.lot : undefined,
      expiryDate: line.trackExpiry && line.expiryDate ? line.expiryDate : undefined,
    }));
    await api.post(`/purchases/${reception.value.purchase.id}/receive`, {
      supplierRef: reception.value.supplierRef,
      documentDate: reception.value.documentDate || undefined,
      dueDate: reception.value.dueDate || undefined,
      items,
    });
    reception.value = null;
  });

const closePurchase = (item: Purchase) =>
  run(async () => {
    if (window.confirm(t('purchases.confirmClose'))) {
      await api.post(`/purchases/${item.id}/close`);
    }
  });

const sendPurchase = (item: Purchase) =>
  run(async () => {
    if (!window.confirm(t('purchases.confirmSend', { to: item.supplier.email }))) return;
    const { data } = await api.post<{ status: string; to: string; error?: string }>(`/purchases/${item.id}/send`);
    if (data.status === 'FAILED') throw new Error(t('purchases.sendFailed', { error: data.error ?? '-' }));
    notice.value = data.status === 'LOGGED' ? t('purchases.sendLogged', { to: data.to }) : t('purchases.sent', { to: data.to });
  });

async function previewPurchase(item: Purchase, paper: PaperWidth) {
  try {
    await previewPdfFrom(`/purchases/${item.id}/pdf`, { paper }, t('purchases.orderNote', { number: purchaseNumber(item) }), paper);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function loadSuggestions() {
  error.value = '';
  try {
    if (!suggest.warehouseId) suggest.warehouseId = warehouses.value[0]?.id ?? 0;
    const { data } = await api.get<PurchaseSuggestion[]>('/purchases/suggestions', { params: { hotelId: hotels.selectedId, warehouseId: suggest.warehouseId } });
    suggest.rows = data.map((row) => ({
      ...row,
      selected: Boolean(row.supplier ?? suppliers.value.some((s) => s.active)),
      order: Number(row.suggested),
      supplierId: row.supplier?.id ?? suppliers.value.find((s) => s.active)?.id ?? 0,
      cost: Number(row.unitCost),
    }));
    suggest.open = true;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

const createFromSuggestions = () =>
  run(async () => {
    const chosen = suggest.rows.filter((row) => row.selected && row.order > 0 && row.supplierId);
    const bySupplier = new Map<number, typeof chosen>();
    for (const row of chosen) bySupplier.set(row.supplierId, [...(bySupplier.get(row.supplierId) ?? []), row]);
    for (const [supplierId, rows] of bySupplier) {
      await api.post('/purchases', {
        supplierId,
        warehouseId: suggest.warehouseId,
        items: rows.map((row) => ({ productId: row.productId, quantity: row.order, unitCost: row.cost, taxRate: productRate(row.productId) })),
      });
    }
    suggest.open = false;
    notice.value = t('purchases.draftsCreated', { n: bySupplier.size });
  });

async function cancel(item: Purchase) {
  if (!(await askConfirm({ title: t('purchases.confirmCancel'), danger: true }))) return;
  await run(() => api.post(`/purchases/${item.id}/cancel`, {}));
}

async function voidPurchase(item: Purchase) {
  const reason = await askText({
    title: t('purchases.voidTitle', { number: item.supplierRef ?? purchaseNumber(item) }),
    message: t('purchases.voidHint'),
    confirmLabel: t('purchases.void'),
    required: true,
    danger: true,
  });
  if (!reason?.trim()) return;
  await run(() => api.post(`/purchases/${item.id}/cancel`, { reason: reason.trim() }));
}

const addSupplier = () =>
  run(async () => {
    await api.post('/suppliers', {
      hotelId: hotels.selectedId,
      name: supplier.name,
      taxId: supplier.taxId || undefined,
      email: supplier.email || undefined,
      phone: supplier.phone || undefined,
    });
    Object.assign(supplier, { name: '', taxId: '', email: '', phone: '' });
  });

const toggleSupplier = (item: Supplier) => run(() => api.patch(`/suppliers/${item.id}`, { active: !item.active }));

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="purchases" :subtitle="t('purchases.subtitle')">
      <div class="flex rounded-lg bg-white p-0.5 text-sm text-slate-700 shadow">
        <button type="button" class="rounded px-4 py-1.5" :class="tab === 'purchases' ? 'bg-indigo-600 text-white' : ''" @click="tab = 'purchases'">
          {{ t('purchases.orders') }}
        </button>
        <button type="button" class="rounded px-4 py-1.5" :class="tab === 'suppliers' ? 'bg-indigo-600 text-white' : ''" @click="tab = 'suppliers'">
          {{ t('purchases.suppliers') }}
        </button>
      </div>
    </PageHeader>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <template v-if="tab === 'purchases'">
      <p v-if="!suppliers.length || !warehouses.length || !products.length" class="text-sm text-slate-500">
        Para registar compras precisas de pelo menos um fornecedor, um armazem e um produto com controlo de stock.
      </p>
      <div v-else-if="!showForm" class="flex flex-wrap gap-2">
        <button class="btn" type="button" @click="newPurchase">{{ t('purchases.new') }}</button>
        <button class="btn-secondary" type="button" @click="loadSuggestions">{{ t('purchases.suggestions') }}</button>
      </div>

      <div v-if="suggest.open" class="card space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-semibold">{{ t('purchases.suggestions') }}</h2>
          <div class="flex items-center gap-2">
            <select v-model.number="suggest.warehouseId" class="input w-auto" @change="loadSuggestions">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
            <button class="text-sm text-slate-500 hover:underline" type="button" @click="suggest.open = false">{{ t('common.close') }}</button>
          </div>
        </div>
        <p class="text-xs text-slate-500">{{ t('purchases.suggestionsHint') }}</p>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 text-slate-600">
              <tr>
                <th class="py-2"></th>
                <th class="py-2">{{ t('common.product') }}</th>
                <th class="py-2 text-right">{{ t('products.stock') }}</th>
                <th class="py-2 text-right">{{ t('stock.minimum') }}</th>
                <th class="py-2 text-right">{{ t('purchases.ordered') }}</th>
                <th class="py-2">{{ t('purchases.order') }}</th>
                <th class="py-2">{{ t('products.cost') }}</th>
                <th class="py-2">{{ t('purchases.supplier') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in suggest.rows" :key="row.productId" class="border-b border-slate-100">
                <td class="py-2 pr-2"><input v-model="row.selected" type="checkbox" :aria-label="t('purchases.include', { name: row.name })" /></td>
                <td class="py-2 font-medium">{{ row.name }}</td>
                <td class="py-2 text-right text-rose-700">{{ qty(row.quantity) }} {{ row.unit }}</td>
                <td class="py-2 text-right">{{ qty(row.minStock) }}</td>
                <td class="py-2 text-right">{{ qty(row.pending) }}</td>
                <td class="py-2"><input v-model.number="row.order" class="input w-24" type="number" min="0.001" step="0.001" /></td>
                <td class="py-2"><input v-model.number="row.cost" class="input w-24" type="number" min="0" step="0.0001" /></td>
                <td class="py-2">
                  <select v-model.number="row.supplierId" class="input">
                    <option v-for="s in suppliers.filter((x) => x.active)" :key="s.id" :value="s.id">{{ s.name }}</option>
                  </select>
                </td>
              </tr>
              <tr v-if="!suggest.rows.length">
                <td colspan="8" class="py-6 text-center text-slate-500">{{ t('purchases.nothing') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex justify-end">
          <button class="btn" type="button" :disabled="busy || !suggest.rows.some((r) => r.selected)" @click="createFromSuggestions">{{ t('purchases.createDrafts') }}</button>
        </div>
      </div>

      <form v-if="reception" class="card space-y-3" @submit.prevent="confirmReception">
        <h2 class="font-semibold">{{ t('purchases.reception') }} · {{ purchaseNumber(reception.purchase) }} · {{ reception.purchase.supplier.name }}</h2>
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="text-sm">
            <span class="mb-1 block text-slate-600">{{ t('purchases.documentRef') }}</span>
            <input v-model="reception.supplierRef" class="input" maxlength="60" required />
          </label>
          <label class="text-sm">
            <span class="mb-1 block text-slate-600">{{ t('purchases.documentDate') }}</span>
            <input v-model="reception.documentDate" class="input" type="date" :max="today()" required />
          </label>
          <label class="text-sm">
            <span class="mb-1 block text-slate-600">{{ t('purchases.dueDate') }}</span>
            <input v-model="reception.dueDate" class="input" type="date" :min="reception.documentDate" />
          </label>
        </div>
        <p class="text-xs text-slate-500">{{ t('purchases.receptionHint') }}</p>
        <div v-for="line in reception.lines" :key="line.itemId" class="grid items-center gap-2 sm:grid-cols-[1fr_110px_120px_150px]">
          <span class="text-sm">
            <span class="font-medium">{{ line.name }}</span>
            <span class="block text-xs text-slate-500">{{ t('purchases.remaining', { n: qty(line.remaining), unit: line.unit }) }}</span>
          </span>
          <input v-model.number="line.quantity" class="input" type="number" min="0" :max="line.remaining" step="0.001" :aria-label="t('purchases.receivedQty')" />
          <template v-if="line.trackExpiry">
            <input v-model="line.lot" class="input" :placeholder="t('purchases.lot')" maxlength="40" />
            <input v-model="line.expiryDate" class="input" type="date" :aria-label="t('purchases.expiry')" />
          </template>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" type="button" @click="reception = null">{{ t('common.cancel') }}</button>
          <button class="btn" type="submit" :disabled="busy">{{ t('purchases.receiveStock') }}</button>
        </div>
      </form>

      <form v-if="showForm" class="card space-y-3" @submit.prevent="savePurchase">
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label class="text-sm">
            <span class="mb-1 block text-slate-600">{{ t('purchases.supplier') }}</span>
            <select v-model.number="purchase.supplierId" class="input" required>
              <option v-for="s in suppliers.filter((x) => x.active)" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </label>
          <label class="text-sm">
            <span class="mb-1 block text-slate-600">{{ t('stock.warehouse') }}</span>
            <select v-model.number="purchase.warehouseId" class="input" required>
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ t('purchases.into', { name: w.name }) }}</option>
            </select>
          </label>
          <label class="text-sm">
            <span class="mb-1 block text-slate-600">{{ t('purchases.supplierRef') }}</span>
            <input v-model="purchase.supplierRef" class="input" maxlength="60" />
          </label>
          <label class="text-sm">
            <span class="mb-1 block text-slate-600">{{ t('purchases.documentDate') }}</span>
            <input v-model="purchase.documentDate" class="input" type="date" :max="today()" />
          </label>
          <label class="text-sm">
            <span class="mb-1 block text-slate-600">{{ t('purchases.dueDate') }}</span>
            <input v-model="purchase.dueDate" class="input" type="date" :min="purchase.documentDate || undefined" />
          </label>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[46rem] text-left text-sm">
            <thead class="text-slate-600">
              <tr>
                <th class="py-1">{{ t('common.product') }}</th>
                <th class="w-24 py-1">{{ t('common.quantity') }}</th>
                <th class="w-28 py-1">{{ t('purchases.costExVat') }}</th>
                <th class="w-24 py-1">{{ t('purchases.discount') }}</th>
                <th class="w-20 py-1">{{ t('purchases.vat') }}</th>
                <th class="w-28 py-1 text-right">{{ t('common.total') }}</th>
                <th class="w-10 py-1"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(line, index) in purchase.items" :key="index">
                <td class="py-1 pr-2">
                  <select v-model.number="line.productId" class="input" @change="onProductChange(line)">
                    <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }} ({{ p.unit }})</option>
                  </select>
                </td>
                <td class="py-1 pr-2"><input v-model.number="line.quantity" class="input" type="number" min="0.001" step="0.001" inputmode="decimal" :aria-label="t('common.quantity')" /></td>
                <td class="py-1 pr-2"><input v-model.number="line.unitCost" class="input" type="number" min="0" step="0.0001" inputmode="decimal" :aria-label="t('purchases.costExVat')" /></td>
                <td class="py-1 pr-2"><input v-model.number="line.discount" class="input" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('purchases.discount')" /></td>
                <td class="py-1 pr-2"><input v-model.number="line.taxRate" class="input" type="number" min="0" max="100" step="0.01" inputmode="decimal" :aria-label="t('purchases.vat')" /></td>
                <td class="py-1 pr-2 text-right tabular-nums">{{ money(lineTotal(line)) }}</td>
                <td class="py-1">
                  <button class="btn-icon text-rose-600" type="button" :disabled="purchase.items.length === 1" :aria-label="t('common.removeLine')" @click="purchase.items.splice(index, 1)">
                    &times;
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <button class="text-sm text-indigo-600 hover:underline" type="button" @click="purchase.items.push(newLine(products[0]))">
            {{ t('common.addLine') }}
          </button>
          <dl class="min-w-56 space-y-1 text-sm tabular-nums">
            <div class="flex justify-between gap-6"><dt>{{ t('purchases.subtotal') }}</dt><dd>{{ money(draftTotals.subtotal) }}</dd></div>
            <div class="flex justify-between gap-6"><dt>{{ t('purchases.discounts') }}</dt><dd>-{{ money(draftTotals.discount) }}</dd></div>
            <div class="flex justify-between gap-6"><dt>{{ t('purchases.vatTotal') }}</dt><dd>{{ money(draftTotals.tax) }}</dd></div>
            <div class="flex justify-between gap-6 text-base font-semibold"><dt>{{ t('common.total') }}</dt><dd>{{ money(draftTotals.total) }}</dd></div>
          </dl>
        </div>
        <label class="block text-sm">
          <span class="mb-1 block text-slate-600">{{ t('purchases.notes') }}</span>
          <textarea v-model="purchase.notes" class="input" rows="2"></textarea>
        </label>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" type="button" @click="showForm = false">{{ t('common.cancel') }}</button>
          <button class="btn" type="submit" :disabled="busy">{{ t('stock.saveDraft') }}</button>
        </div>
      </form>

      <div class="card overflow-x-auto p-0">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th class="px-4 py-3">{{ t('common.date') }}</th>
              <th class="px-4 py-3">N.o</th>
              <th class="px-4 py-3">{{ t('purchases.supplier') }}</th>
              <th class="px-4 py-3">{{ t('purchases.ref') }}</th>
              <th class="px-4 py-3">{{ t('stock.warehouse') }}</th>
              <th class="px-4 py-3">{{ t('stock.products') }}</th>
              <th class="px-4 py-3 text-right">{{ t('common.total') }}</th>
              <th class="px-4 py-3">{{ t('common.status') }}</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in purchases" :key="item.id" class="border-b border-slate-100">
              <td class="px-4 py-3 whitespace-nowrap">{{ formatDateTime(item.orderedAt) }}</td>
              <td class="px-4 py-3 whitespace-nowrap">
                {{ purchaseNumber(item) }}
                <span v-if="item.sentAt" class="block text-xs text-slate-500">{{ t('purchases.sentAt', { date: formatDateTime(item.sentAt) }) }}</span>
              </td>
              <td class="px-4 py-3 font-medium">{{ item.supplier.name }}</td>
              <td class="px-4 py-3">
                {{ item.supplierRef ?? '-' }}
                <span v-if="item.documentDate" class="block text-xs text-slate-500">{{ formatDate(item.documentDate.slice(0, 10)) }}</span>
                <span v-if="item.dueDate" class="block text-xs text-slate-500">{{ t('purchases.dueDate') }} {{ formatDate(item.dueDate.slice(0, 10)) }}</span>
              </td>
              <td class="px-4 py-3">{{ item.warehouse.name }}</td>
              <td class="px-4 py-3 text-slate-600">
                <span v-for="(line, index) in item.items" :key="line.id">
                  {{ index ? ', ' : '' }}{{ qty(line.quantity) }} {{ line.product.name }}<template v-if="item.status === 'PARTIAL'"> ({{ t('purchases.received', { n: qty(line.receivedQuantity) }) }})</template>
                </span>
              </td>
              <td class="px-4 py-3 text-right">{{ money(item.total) }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs whitespace-nowrap" :class="STATUS_CLASSES[item.status]">{{ STATUS_LABELS[item.status] }}</span>
                <span v-if="item.cancelReason" class="mt-1 block text-xs text-slate-500">{{ t('purchases.voided', { reason: item.cancelReason }) }}</span>
              </td>
              <td class="space-x-3 px-4 py-3 text-right text-xs whitespace-nowrap">
                <button class="text-slate-600 hover:underline" type="button" @click="previewPurchase(item, 'A4')">PDF</button>
                <button class="text-slate-600 hover:underline" type="button" @click="previewPurchase(item, 'MM80')">80 mm</button>
                <button
                  v-if="(item.status === 'DRAFT' || item.status === 'PARTIAL') && item.supplier.email"
                  class="text-indigo-600 hover:underline"
                  type="button"
                  @click="sendPurchase(item)"
                >
                  {{ t('purchases.send') }}
                </button>
                <template v-if="item.status === 'DRAFT'">
                  <button class="text-indigo-600 hover:underline" type="button" @click="editPurchase(item)">{{ t('common.edit') }}</button>
                  <button class="font-semibold text-emerald-700 hover:underline" type="button" @click="startReception(item)">{{ t('roomAccount.receive') }}</button>
                  <button class="text-rose-600 hover:underline" type="button" @click="cancel(item)">{{ t('common.cancel') }}</button>
                </template>
                <template v-if="item.status === 'PARTIAL'">
                  <button class="font-semibold text-emerald-700 hover:underline" type="button" @click="startReception(item)">{{ t('purchases.receiveRest') }}</button>
                  <button class="text-slate-600 hover:underline" type="button" @click="closePurchase(item)">{{ t('purchases.complete') }}</button>
                </template>
                <button v-if="item.status === 'PARTIAL' || item.status === 'RECEIVED'" class="text-rose-600 hover:underline" type="button" @click="voidPurchase(item)">
                  {{ t('purchases.void') }}
                </button>
              </td>
            </tr>
            <tr v-if="!purchases.length">
              <td colspan="9" class="px-4 py-6 text-center text-slate-500">{{ t('purchases.empty') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <form class="card grid gap-3 sm:grid-cols-5" @submit.prevent="addSupplier">
        <input v-model="supplier.name" class="input sm:col-span-2" :placeholder="t('common.name')" required />
        <input v-model="supplier.taxId" class="input" :placeholder="t('purchases.taxId')" />
        <input v-model="supplier.email" class="input" type="email" :placeholder="t('common.email')" />
        <input v-model="supplier.phone" class="input" :placeholder="t('common.phone')" />
        <button class="btn sm:col-span-5 sm:justify-self-end" type="submit" :disabled="busy">{{ t('purchases.addSupplier') }}</button>
      </form>
      <div class="card overflow-x-auto p-0">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th class="px-4 py-3">{{ t('common.name') }}</th>
              <th class="px-4 py-3">{{ t('purchases.taxId') }}</th>
              <th class="px-4 py-3">{{ t('purchases.contact') }}</th>
              <th class="px-4 py-3 text-right">{{ t('purchases.purchaseCount') }}</th>
              <th class="px-4 py-3 text-right">{{ t('purchases.purchaseTotal') }}</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in suppliers" :key="item.id" class="border-b border-slate-100" :class="item.active ? '' : 'text-slate-400'">
              <td class="px-4 py-3 font-medium">{{ item.name }}</td>
              <td class="px-4 py-3">{{ item.taxId ?? '-' }}</td>
              <td class="px-4 py-3">{{ [item.email, item.phone].filter(Boolean).join(' · ') || '-' }}</td>
              <td class="px-4 py-3 text-right tabular-nums">{{ item.purchaseCount }}</td>
              <td class="px-4 py-3 text-right tabular-nums">{{ money(item.purchaseTotal) }}</td>
              <td class="px-4 py-3 text-right">
                <button class="text-xs text-indigo-600 hover:underline" type="button" @click="toggleSupplier(item)">
                  {{ item.active ? t('purchases.deactivate') : t('purchases.activate') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

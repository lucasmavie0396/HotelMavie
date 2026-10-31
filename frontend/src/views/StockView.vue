<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { translated } from '@/i18n';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import { previewPdfFrom } from '@/services/print';
import type { PaperWidth, StockDocument, StockDocumentType, StockLevelRow, StockLot, StockMovement, Supplier, Warehouse } from '@/types';
import { formatDate, formatDateTime, formatMoney } from '@/utils/format';

const MOVEMENT_LABELS = translated<StockMovement['type']>('stock.movements', ['PURCHASE', 'SALE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'WASTE', 'RETURN']);
const TYPE_LABELS = translated<StockDocumentType>('stock.types', ['INVENTORY', 'WASTE', 'TRANSFER', 'RETURN']);
const TYPE_PREFIX: Record<StockDocumentType, string> = { INVENTORY: 'INV', WASTE: 'QB', TRANSFER: 'TR', RETURN: 'DV' };
const STATUS_LABELS = translated<StockDocument['status']>('stock.statuses', ['DRAFT', 'POSTED', 'CANCELLED']);
const STATUS_CLASSES: Record<StockDocument['status'], string> = {
  DRAFT: 'bg-amber-100 text-amber-800',
  POSTED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const tab = ref<'levels' | 'documents'>('levels');
const warehouses = ref<Warehouse[]>([]);
const warehouseId = ref(0);
const levels = ref<StockLevelRow[]>([]);
const documents = ref<StockDocument[]>([]);
const error = ref('');
const busy = ref(false);
const onlyLow = ref(false);
const newWarehouse = ref('');
const typeFilter = ref<'' | StockDocumentType>('');
const expandedId = ref<number | null>(null);
const history = ref<{ product: StockLevelRow; movements: StockMovement[]; lots: StockLot[] } | null>(null);
const suppliers = ref<Supplier[]>([]);

const form = reactive({
  open: false,
  editingId: null as number | null,
  type: 'WASTE' as StockDocumentType,
  toWarehouseId: 0,
  supplierId: 0,
  reason: '',
  items: [] as { productId: number; quantity: number }[],
});

const isManager = computed(() => auth.isManager);
const shown = computed(() => (onlyLow.value ? levels.value.filter((l) => l.belowMinimum) : levels.value));
const stockValue = computed(() => levels.value.reduce((sum, l) => sum + Math.max(Number(l.quantity), 0) * Number(l.cost), 0));
const filteredDocuments = computed(() => documents.value.filter((d) => !typeFilter.value || d.type === typeFilter.value));
const drafts = computed(() => documents.value.filter((d) => d.status === 'DRAFT').length);
const otherWarehouses = computed(() => warehouses.value.filter((w) => w.id !== warehouseId.value));
const levelOf = (productId: number) => levels.value.find((l) => l.id === productId);
const docNumber = (d: { id: number; type: StockDocumentType; year: number | null; number: number | null }) =>
  d.number ? `${TYPE_PREFIX[d.type]} ${d.year}/${d.number}` : `${TYPE_PREFIX[d.type]} #${d.id}`;
const editingDocument = computed(() => documents.value.find((d) => d.id === form.editingId));
const qty = (value: string | number | null) => (value === null ? '-' : Number(value).toLocaleString('pt-PT', { maximumFractionDigits: 3 }));

function summary(d: StockDocument) {
  const parts = d.items.slice(0, 3).map((i) => `${qty(i.quantity)} ${i.product.name}`);
  return d.items.length > 3 ? `${parts.join(', ')} e mais ${d.items.length - 3}` : parts.join(', ');
}

function movementSource(m: StockMovement) {
  if (m.document) return docNumber(m.document);
  if (m.purchase) return m.purchase.supplierRef ? `Compra ${m.purchase.supplierRef}` : `Compra #${m.purchase.id}`;
  return m.reason ?? '';
}

async function loadWarehouses() {
  warehouses.value = (await api.get<Warehouse[]>('/warehouses', { params: { hotelId: hotels.selectedId } })).data;
  if (!warehouses.value.some((w) => w.id === warehouseId.value)) {
    warehouseId.value = warehouses.value[0]?.id ?? 0;
  }
}

async function load() {
  error.value = '';
  try {
    await loadWarehouses();
    if (!warehouseId.value) return;
    const [l, d] = await Promise.all([
      api.get<StockLevelRow[]>(`/warehouses/${warehouseId.value}/stock`),
      api.get<StockDocument[]>('/stock-documents', { params: { hotelId: hotels.selectedId, warehouseId: warehouseId.value } }),
    ]);
    levels.value = l.data;
    documents.value = d.data;
    if (isManager.value && !suppliers.value.length) {
      suppliers.value = (await api.get<Supplier[]>('/suppliers', { params: { hotelId: hotels.selectedId } })).data.filter((s) => s.active);
    }
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
    await load();
    if (history.value) await openHistory(history.value.product);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function changeWarehouse() {
  form.open = false;
  history.value = null;
  load();
}

function newDocument(type: StockDocumentType) {
  const first = levels.value[0];
  Object.assign(form, {
    open: true,
    editingId: null,
    type,
    toWarehouseId: otherWarehouses.value[0]?.id ?? 0,
    supplierId: suppliers.value[0]?.id ?? 0,
    reason: '',
    items:
      type === 'INVENTORY'
        ? levels.value.map((l) => ({ productId: l.id, quantity: Math.max(Number(l.quantity), 0) }))
        : first
          ? [{ productId: first.id, quantity: 1 }]
          : [],
  });
  tab.value = 'documents';
}

function editDocument(d: StockDocument) {
  Object.assign(form, {
    open: true,
    editingId: d.id,
    type: d.type,
    toWarehouseId: d.toWarehouse?.id ?? 0,
    supplierId: d.supplier?.id ?? 0,
    reason: d.reason ?? '',
    items: d.items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })),
  });
}

function addLine() {
  const used = new Set(form.items.map((i) => i.productId));
  const next = levels.value.find((l) => !used.has(l.id));
  if (next) form.items.push({ productId: next.id, quantity: form.type === 'INVENTORY' ? Math.max(Number(next.quantity), 0) : 1 });
}

const saveDocument = (post: boolean) =>
  run(async () => {
    const payload = {
      type: form.type,
      warehouseId: warehouseId.value,
      toWarehouseId: form.type === 'TRANSFER' ? form.toWarehouseId : undefined,
      supplierId: form.type === 'RETURN' ? form.supplierId : undefined,
      reason: form.reason || undefined,
      items: form.items,
    };
    const saved = form.editingId
      ? await api.patch<StockDocument>(`/stock-documents/${form.editingId}`, payload)
      : await api.post<StockDocument>('/stock-documents', payload);
    form.editingId = saved.data.id;
    if (post) await api.post(`/stock-documents/${saved.data.id}/post`);
    form.open = false;
  });

const postDocument = (d: StockDocument) =>
  run(async () => {
    if (window.confirm(t('stock.confirmPost', { number: docNumber(d) }))) {
      await api.post(`/stock-documents/${d.id}/post`);
    }
  });

const cancelDocument = (d: StockDocument) =>
  run(async () => {
    if (window.confirm(t('stock.confirmCancel', { number: docNumber(d) }))) {
      await api.post(`/stock-documents/${d.id}/cancel`);
    }
  });

async function openHistory(product: StockLevelRow) {
  try {
    const [movements, lots] = await Promise.all([
      api.get<StockMovement[]>('/stock-movements', { params: { hotelId: hotels.selectedId, warehouseId: warehouseId.value, productId: product.id } }),
      product.trackExpiry ? api.get<StockLot[]>(`/warehouses/${warehouseId.value}/lots`, { params: { productId: product.id } }) : Promise.resolve({ data: [] }),
    ]);
    history.value = { product, movements: movements.data, lots: lots.data };
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function previewDocument(d: StockDocument, paper: PaperWidth) {
  try {
    await previewPdfFrom(`/stock-documents/${d.id}/pdf`, { paper }, `${TYPE_LABELS[d.type]} ${docNumber(d)}`, paper);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function previewCountSheet(withQuantities: boolean) {
  try {
    await previewPdfFrom(`/warehouses/${warehouseId.value}/count-sheet`, { withQuantities, paper: 'A4' }, t('stock.countSheet'), 'A4');
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function expiryClass(lot: StockLot) {
  if (!lot.expiryDate) return 'text-slate-400';
  const days = (new Date(lot.expiryDate).getTime() - Date.now()) / 86_400_000;
  return days < 0 ? 'font-semibold text-rose-700' : days < 30 ? 'text-amber-700' : '';
}

const createWarehouse = () =>
  run(async () => {
    await api.post('/warehouses', { hotelId: hotels.selectedId, name: newWarehouse.value });
    newWarehouse.value = '';
  });

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="stock" :subtitle="t('stock.subtitle')">
      <select v-model.number="warehouseId" class="input w-auto" @change="changeWarehouse">
        <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}{{ w.isDefault ? ` (${t('stock.main')})` : '' }}</option>
      </select>
      <form v-if="isManager" class="flex gap-2" @submit.prevent="createWarehouse">
        <input v-model="newWarehouse" class="input w-40" :placeholder="t('stock.newWarehouse')" required />
        <button class="btn-secondary" type="submit" :disabled="busy">{{ t('common.create') }}</button>
      </form>
    </PageHeader>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="!warehouses.length" class="text-sm text-slate-500">{{ t('stock.noWarehouse') }}</p>

    <template v-if="warehouseId">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex rounded-lg bg-white p-0.5 text-sm text-slate-700 shadow">
          <button type="button" class="rounded px-4 py-1.5" :class="tab === 'levels' ? 'bg-indigo-600 text-white' : ''" @click="tab = 'levels'">
            {{ t('stock.levels') }}
          </button>
          <button type="button" class="rounded px-4 py-1.5" :class="tab === 'documents' ? 'bg-indigo-600 text-white' : ''" @click="tab = 'documents'">
            {{ t('stock.documents') }}
            <span v-if="drafts" class="ml-1 rounded-full bg-amber-400 px-1.5 text-xs text-white">{{ drafts }}</span>
          </button>
        </div>
        <div v-if="levels.length" class="flex flex-wrap gap-2">
          <button v-if="isManager" class="btn-secondary" type="button" @click="newDocument('INVENTORY')">{{ t('stock.newInventory') }}</button>
          <button class="btn-secondary" type="button" @click="newDocument('WASTE')">{{ t('stock.newWaste') }}</button>
          <button v-if="isManager && otherWarehouses.length" class="btn-secondary" type="button" @click="newDocument('TRANSFER')">{{ t('stock.newTransfer') }}</button>
          <button v-if="isManager && suppliers.length" class="btn-secondary" type="button" @click="newDocument('RETURN')">{{ t('stock.newReturn') }}</button>
        </div>
      </div>

      <template v-if="tab === 'levels'">
        <div class="flex flex-wrap items-center gap-4 text-sm">
          <label class="flex items-center gap-2"><input v-model="onlyLow" type="checkbox" />{{ t('stock.onlyLow') }}</label>
          <span class="text-slate-600">{{ t('stock.value') }} <strong>{{ formatMoney(stockValue, hotels.currency) }}</strong></span>
          <span class="ml-auto flex gap-3 text-xs">
            <button class="text-indigo-600 hover:underline" type="button" @click="previewCountSheet(false)">{{ t('stock.countSheet') }}</button>
            <button v-if="isManager" class="text-indigo-600 hover:underline" type="button" @click="previewCountSheet(true)">{{ t('stock.countSheetQty') }}</button>
          </span>
        </div>

        <div v-if="history" class="card overflow-x-auto p-0">
          <div class="flex items-center justify-between px-4 pt-4">
            <h2 class="font-semibold">{{ t('stock.history') }} · {{ history.product.name }}</h2>
            <button class="text-sm text-slate-500 hover:underline" type="button" @click="history = null">{{ t('common.close') }}</button>
          </div>
          <div v-if="history.product.trackExpiry" class="flex flex-wrap gap-2 px-4 pt-3 text-xs">
            <span class="text-slate-500">{{ t('stock.lots') }}</span>
            <span v-for="lot in history.lots" :key="lot.id" class="rounded-full bg-slate-100 px-2 py-0.5" :class="expiryClass(lot)">
              {{ lot.code ?? t('stock.noLot') }} · {{ lot.expiryDate ? formatDate(lot.expiryDate) : t('stock.noExpiry') }} · {{ qty(lot.quantity) }} {{ history.product.unit }}
            </span>
            <span v-if="!history.lots.length" class="text-slate-400">{{ t('stock.noLots') }}</span>
          </div>
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 text-slate-600">
              <tr>
                <th class="px-4 py-2">{{ t('common.date') }}</th>
                <th class="px-4 py-2">{{ t('rooms.type') }}</th>
                <th class="px-4 py-2">{{ t('guest.document') }}</th>
                <th class="px-4 py-2 text-right">{{ t('folio.qty') }}</th>
                <th class="px-4 py-2 text-right">{{ t('folio.balance') }}</th>
                <th class="px-4 py-2">{{ t('stock.user') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in history.movements" :key="m.id" class="border-b border-slate-100">
                <td class="px-4 py-2">{{ formatDateTime(m.createdAt) }}</td>
                <td class="px-4 py-2">{{ MOVEMENT_LABELS[m.type] }}</td>
                <td class="px-4 py-2 text-slate-500">{{ movementSource(m) }}</td>
                <td class="px-4 py-2 text-right" :class="Number(m.quantity) < 0 ? 'text-rose-600' : 'text-emerald-700'">{{ qty(m.quantity) }}</td>
                <td class="px-4 py-2 text-right">{{ qty(m.balance) }}</td>
                <td class="px-4 py-2 text-slate-500">{{ m.createdBy?.name ?? '-' }}</td>
              </tr>
              <tr v-if="!history.movements.length">
                <td colspan="6" class="px-4 py-6 text-center text-slate-500">{{ t('stock.noMovements') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card overflow-x-auto p-0">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th class="px-4 py-3">{{ t('common.product') }}</th>
                <th class="px-4 py-3 text-right">{{ t('common.quantity') }}</th>
                <th class="px-4 py-3 text-right">{{ t('stock.minimum') }}</th>
                <th class="px-4 py-3 text-right">{{ t('stock.averageCost') }}</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in shown" :key="row.id" class="border-b border-slate-100" :class="row.belowMinimum ? 'bg-rose-50' : ''">
                <td class="px-4 py-3 font-medium">{{ row.name }} <span class="text-xs text-slate-500">{{ row.category?.name }}</span></td>
                <td class="px-4 py-3 text-right" :class="row.belowMinimum ? 'font-semibold text-rose-700' : ''">{{ qty(row.quantity) }} {{ row.unit }}</td>
                <td class="px-4 py-3 text-right">{{ qty(row.minStock) }}</td>
                <td class="px-4 py-3 text-right">{{ formatMoney(row.cost, hotels.currency) }}</td>
                <td class="px-4 py-3 text-right text-xs">
                  <button class="text-indigo-600 hover:underline" type="button" @click="openHistory(row)">{{ t('stock.history') }}</button>
                </td>
              </tr>
              <tr v-if="!shown.length">
                <td colspan="5" class="px-4 py-6 text-center text-slate-500">{{ t('stock.noProducts') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else>
        <form v-if="form.open" class="card space-y-3" @submit.prevent="saveDocument(false)">
          <h2 class="font-semibold">
            {{ editingDocument ? t('stock.editDocument', { number: docNumber(editingDocument) }) : t('stock.newDocument', { type: TYPE_LABELS[form.type].toLowerCase() }) }}
            <span class="font-normal text-slate-500">· {{ warehouses.find((w) => w.id === warehouseId)?.name }}</span>
          </h2>
          <div class="grid gap-3 sm:grid-cols-3">
            <select v-if="form.type === 'TRANSFER'" v-model.number="form.toWarehouseId" class="input" required>
              <option v-for="w in otherWarehouses" :key="w.id" :value="w.id">{{ t('stock.toWarehouse', { name: w.name }) }}</option>
            </select>
            <select v-if="form.type === 'RETURN'" v-model.number="form.supplierId" class="input" required>
              <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ t('stock.returnTo', { name: s.name }) }}</option>
            </select>
            <input
              v-model="form.reason"
              class="input"
              :class="form.type === 'TRANSFER' || form.type === 'RETURN' ? 'sm:col-span-2' : 'sm:col-span-3'"
              :placeholder="form.type === 'WASTE' ? t('stock.wasteReason') : form.type === 'RETURN' ? t('stock.returnReason') : t('stock.observation')"
              :required="form.type === 'WASTE' || form.type === 'RETURN'"
              maxlength="200"
            />
          </div>
          <div class="grid grid-cols-[1fr_90px_110px_32px] gap-2 text-xs text-slate-500">
            <span>{{ t('common.product') }}</span>
            <span class="text-right">{{ form.type === 'INVENTORY' ? t('stock.current') : t('stock.available') }}</span>
            <span>{{ form.type === 'INVENTORY' ? t('stock.counted') : t('common.quantity') }}</span>
            <span></span>
          </div>
          <div v-for="(line, index) in form.items" :key="index" class="grid grid-cols-[1fr_90px_110px_32px] items-center gap-2">
            <select v-model.number="line.productId" class="input">
              <option v-for="p in levels" :key="p.id" :value="p.id" :disabled="p.id !== line.productId && form.items.some((i) => i.productId === p.id)">
                {{ p.name }} ({{ p.unit }})
              </option>
            </select>
            <span class="text-right text-sm text-slate-500">{{ qty(levelOf(line.productId)?.quantity ?? 0) }}</span>
            <input
              v-model.number="line.quantity"
              class="input"
              type="number"
              :min="form.type === 'INVENTORY' ? 0 : 0.001"
              step="0.001"
              required
              :aria-label="t('common.quantity')"
            />
            <button class="text-rose-600" type="button" :disabled="form.items.length === 1" :aria-label="t('common.removeLine')" @click="form.items.splice(index, 1)">
              &times;
            </button>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <button class="text-sm text-indigo-600 hover:underline" type="button" :disabled="form.items.length >= levels.length" @click="addLine">{{ t('common.addLine') }}</button>
            <span class="text-sm text-slate-500">{{ form.items.length }} produto(s)</span>
          </div>
          <div class="flex flex-wrap justify-end gap-2">
            <button class="btn-secondary" type="button" @click="form.open = false">{{ t('common.close') }}</button>
            <button class="btn-secondary" type="submit" :disabled="busy">{{ t('stock.saveDraft') }}</button>
            <button class="btn" type="button" :disabled="busy" @click="saveDocument(true)">{{ t('stock.savePost') }}</button>
          </div>
        </form>

        <div class="flex flex-wrap items-center gap-2 text-sm">
          <select v-model="typeFilter" class="input w-auto">
            <option value="">{{ t('stock.allTypes') }}</option>
            <option v-for="(label, key) in TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>

        <div class="card overflow-x-auto p-0">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th class="px-4 py-3">{{ t('common.date') }}</th>
                <th class="px-4 py-3">{{ t('guest.document') }}</th>
                <th class="px-4 py-3">{{ t('stock.warehouse') }}</th>
                <th class="px-4 py-3">{{ t('stock.products') }}</th>
                <th class="px-4 py-3">{{ t('common.reason') }}</th>
                <th class="px-4 py-3">{{ t('common.status') }}</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="d in filteredDocuments" :key="d.id">
                <tr class="cursor-pointer border-b border-slate-100 hover:bg-slate-50" @click="expandedId = expandedId === d.id ? null : d.id">
                  <td class="px-4 py-3 whitespace-nowrap">{{ formatDateTime(d.postedAt ?? d.createdAt) }}</td>
                  <td class="px-4 py-3 whitespace-nowrap">
                    <span class="font-medium">{{ docNumber(d) }}</span>
                    <span class="block text-xs text-slate-500">{{ TYPE_LABELS[d.type] }}</span>
                  </td>
                  <td class="px-4 py-3">
                    {{ d.warehouse.name }}<template v-if="d.toWarehouse"> &rarr; {{ d.toWarehouse.name }}</template>
                    <span v-if="d.supplier" class="block text-xs text-slate-500">&rarr; {{ d.supplier.name }}</span>
                  </td>
                  <td class="px-4 py-3 text-slate-600">{{ summary(d) }}</td>
                  <td class="px-4 py-3 text-slate-500">{{ d.reason ?? '-' }}</td>
                  <td class="px-4 py-3">
                    <span class="rounded-full px-2 py-0.5 text-xs" :class="STATUS_CLASSES[d.status]">{{ STATUS_LABELS[d.status] }}</span>
                  </td>
                  <td class="space-x-3 px-4 py-3 text-right text-xs whitespace-nowrap" @click.stop>
                    <button class="text-slate-600 hover:underline" type="button" @click="previewDocument(d, 'A4')">PDF</button>
                    <button class="text-slate-600 hover:underline" type="button" @click="previewDocument(d, 'MM80')">80 mm</button>
                    <template v-if="d.status === 'DRAFT' && (isManager || d.type === 'WASTE')">
                      <button class="text-indigo-600 hover:underline" type="button" @click="editDocument(d)">{{ t('common.edit') }}</button>
                      <button class="font-semibold text-emerald-700 hover:underline" type="button" @click="postDocument(d)">{{ t('stock.post') }}</button>
                      <button class="text-rose-600 hover:underline" type="button" @click="cancelDocument(d)">{{ t('common.cancel') }}</button>
                    </template>
                  </td>
                </tr>
                <tr v-if="expandedId === d.id" class="border-b border-slate-100 bg-slate-50/60">
                  <td colspan="7" class="px-4 py-3">
                    <table class="w-full text-sm">
                      <thead class="text-xs text-slate-500">
                        <tr>
                          <th class="py-1 text-left">{{ t('common.product') }}</th>
                          <template v-if="d.type === 'INVENTORY'">
                            <th class="py-1 text-right">{{ t('stock.before') }}</th>
                            <th class="py-1 text-right">{{ t('stock.counted') }}</th>
                            <th class="py-1 text-right">{{ t('stock.difference') }}</th>
                          </template>
                          <th v-else class="py-1 text-right">{{ t('common.quantity') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="i in d.items" :key="i.id">
                          <td class="py-1">{{ i.product.name }}</td>
                          <template v-if="d.type === 'INVENTORY'">
                            <td class="py-1 text-right">{{ qty(i.previousQuantity) }}</td>
                            <td class="py-1 text-right">{{ qty(i.quantity) }} {{ i.product.unit }}</td>
                            <td
                              class="py-1 text-right"
                              :class="i.previousQuantity === null ? '' : Number(i.quantity) < Number(i.previousQuantity) ? 'text-rose-600' : Number(i.quantity) > Number(i.previousQuantity) ? 'text-emerald-700' : 'text-slate-400'"
                            >
                              {{ i.previousQuantity === null ? '-' : qty(Number(i.quantity) - Number(i.previousQuantity)) }}
                            </td>
                          </template>
                          <td v-else class="py-1 text-right">{{ qty(i.quantity) }} {{ i.product.unit }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p class="mt-2 text-xs text-slate-500">
                      {{ t('stock.createdAt', { date: formatDateTime(d.createdAt) }) }}{{ d.createdBy ? ` ${t('stock.by', { name: d.createdBy.name })}` : '' }}{{ d.postedAt ? ` · ${t('stock.postedAt', { date: formatDateTime(d.postedAt) })}` : '' }}
                    </p>
                  </td>
                </tr>
              </template>
              <tr v-if="!filteredDocuments.length">
                <td colspan="7" class="px-4 py-6 text-center text-slate-500">{{ t('stock.noDocuments') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import { previewPdfFrom } from '@/services/print';
import type { PaperWidth, Product, Purchase, PurchaseSuggestion, Supplier, Warehouse } from '@/types';
import { formatDateTime, formatMoney } from '@/utils/format';

const STATUS_LABELS: Record<Purchase['status'], string> = { DRAFT: 'Rascunho', PARTIAL: 'Recebida em parte', RECEIVED: 'Recebida', CANCELLED: 'Cancelada' };
const STATUS_CLASSES: Record<Purchase['status'], string> = {
  DRAFT: 'bg-amber-100 text-amber-800',
  PARTIAL: 'bg-sky-100 text-sky-800',
  RECEIVED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const hotels = useHotelsStore();
const tab = ref<'purchases' | 'suppliers'>('purchases');
const purchases = ref<Purchase[]>([]);
const suppliers = ref<Supplier[]>([]);
const warehouses = ref<Warehouse[]>([]);
const products = ref<Product[]>([]);
const error = ref('');
const busy = ref(false);
const editingId = ref<number | null>(null);
const showForm = ref(false);

const supplier = reactive({ name: '', taxId: '', email: '', phone: '' });
const purchase = reactive({
  supplierId: 0,
  warehouseId: 0,
  supplierRef: '',
  items: [] as { productId: number; quantity: number; unitCost: number }[],
});

const notice = ref('');
const reception = ref<{
  purchase: Purchase;
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
const draftTotal = computed(() => purchase.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0));

async function load() {
  error.value = '';
  try {
    const params = { hotelId: hotels.selectedId };
    const [p, s, w, pr] = await Promise.all([
      api.get<Purchase[]>('/purchases', { params }),
      api.get<Supplier[]>('/suppliers', { params }),
      api.get<Warehouse[]>('/warehouses', { params }),
      api.get<Product[]>('/products', { params }),
    ]);
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
    items: [{ productId: products.value[0]?.id ?? 0, quantity: 1, unitCost: Number(products.value[0]?.cost ?? 0) }],
  });
  showForm.value = true;
}

function editPurchase(item: Purchase) {
  editingId.value = item.id;
  Object.assign(purchase, {
    supplierId: item.supplier.id,
    warehouseId: item.warehouse.id,
    supplierRef: item.supplierRef ?? '',
    items: item.items.map((line) => ({ productId: line.productId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
  });
  showForm.value = true;
}

function onProductChange(line: { productId: number; unitCost: number }) {
  line.unitCost = Number(products.value.find((p) => p.id === line.productId)?.cost ?? 0);
}

const savePurchase = () =>
  run(async () => {
    const payload = { ...purchase, supplierRef: purchase.supplierRef || undefined };
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
    await api.post(`/purchases/${reception.value.purchase.id}/receive`, { items });
    reception.value = null;
  });

const closePurchase = (item: Purchase) =>
  run(async () => {
    if (window.confirm('Dar a compra por concluida? O que falta receber deixa de ficar pendente.')) {
      await api.post(`/purchases/${item.id}/close`);
    }
  });

const sendPurchase = (item: Purchase) =>
  run(async () => {
    if (!window.confirm(`Enviar a encomenda por email para ${item.supplier.email}?`)) return;
    const { data } = await api.post<{ status: string; to: string; error?: string }>(`/purchases/${item.id}/send`);
    if (data.status === 'FAILED') throw new Error(`Falha no envio: ${data.error ?? 'erro desconhecido'}`);
    notice.value = data.status === 'LOGGED' ? `Email registado para ${data.to} (sem SMTP configurado, nao saiu)` : `Encomenda enviada para ${data.to}`;
  });

async function previewPurchase(item: Purchase, paper: PaperWidth) {
  try {
    await previewPdfFrom(`/purchases/${item.id}/pdf`, { paper }, `Nota de encomenda ${purchaseNumber(item)}`, paper);
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
      selected: Boolean(row.supplier),
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
        items: rows.map((row) => ({ productId: row.productId, quantity: row.order, unitCost: row.cost })),
      });
    }
    suggest.open = false;
    notice.value = `${bySupplier.size} rascunho(s) de compra criados`;
  });

const cancel = (item: Purchase) =>
  run(async () => {
    if (window.confirm('Cancelar esta compra?')) {
      await api.post(`/purchases/${item.id}/cancel`);
    }
  });

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
    <PageHeader section="purchases" subtitle="Encomendas a fornecedores e rececao de mercadoria">
      <div class="flex rounded-lg bg-white p-0.5 text-sm text-slate-700 shadow">
        <button type="button" class="rounded px-4 py-1.5" :class="tab === 'purchases' ? 'bg-indigo-600 text-white' : ''" @click="tab = 'purchases'">
          Encomendas
        </button>
        <button type="button" class="rounded px-4 py-1.5" :class="tab === 'suppliers' ? 'bg-indigo-600 text-white' : ''" @click="tab = 'suppliers'">
          Fornecedores
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
        <button class="btn" type="button" @click="newPurchase">Nova compra</button>
        <button class="btn-secondary" type="button" @click="loadSuggestions">Sugestoes de encomenda</button>
      </div>

      <div v-if="suggest.open" class="card space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-semibold">Sugestoes de encomenda</h2>
          <div class="flex items-center gap-2">
            <select v-model.number="suggest.warehouseId" class="input w-auto" @change="loadSuggestions">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
            <button class="text-sm text-slate-500 hover:underline" type="button" @click="suggest.open = false">Fechar</button>
          </div>
        </div>
        <p class="text-xs text-slate-500">Produtos abaixo do minimo. A quantidade sugerida repoe o dobro do minimo, descontando o que ja esta encomendado.</p>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 text-slate-600">
              <tr>
                <th class="py-2"></th>
                <th class="py-2">Produto</th>
                <th class="py-2 text-right">Stock</th>
                <th class="py-2 text-right">Minimo</th>
                <th class="py-2 text-right">Encomendado</th>
                <th class="py-2">Encomendar</th>
                <th class="py-2">Custo</th>
                <th class="py-2">Fornecedor</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in suggest.rows" :key="row.productId" class="border-b border-slate-100">
                <td class="py-2 pr-2"><input v-model="row.selected" type="checkbox" :aria-label="`Incluir ${row.name}`" /></td>
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
                <td colspan="8" class="py-6 text-center text-slate-500">Nada a encomendar neste armazem</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex justify-end">
          <button class="btn" type="button" :disabled="busy || !suggest.rows.some((r) => r.selected)" @click="createFromSuggestions">Criar rascunhos por fornecedor</button>
        </div>
      </div>

      <form v-if="reception" class="card space-y-3" @submit.prevent="confirmReception">
        <h2 class="font-semibold">Rececao · {{ purchaseNumber(reception.purchase) }} · {{ reception.purchase.supplier.name }}</h2>
        <p class="text-xs text-slate-500">Indica o que chegou. O que ficar por receber mantem a compra aberta (recebida em parte).</p>
        <div v-for="line in reception.lines" :key="line.itemId" class="grid items-center gap-2 sm:grid-cols-[1fr_110px_120px_150px]">
          <span class="text-sm">
            <span class="font-medium">{{ line.name }}</span>
            <span class="block text-xs text-slate-500">faltam {{ qty(line.remaining) }} {{ line.unit }}</span>
          </span>
          <input v-model.number="line.quantity" class="input" type="number" min="0" :max="line.remaining" step="0.001" aria-label="Quantidade recebida" />
          <template v-if="line.trackExpiry">
            <input v-model="line.lot" class="input" placeholder="Lote" maxlength="40" />
            <input v-model="line.expiryDate" class="input" type="date" aria-label="Validade" />
          </template>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" type="button" @click="reception = null">Cancelar</button>
          <button class="btn" type="submit" :disabled="busy">Dar entrada em stock</button>
        </div>
      </form>

      <form v-if="showForm" class="card space-y-3" @submit.prevent="savePurchase">
        <div class="grid gap-3 sm:grid-cols-3">
          <select v-model.number="purchase.supplierId" class="input" required>
            <option v-for="s in suppliers.filter((x) => x.active)" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <select v-model.number="purchase.warehouseId" class="input" required>
            <option v-for="w in warehouses" :key="w.id" :value="w.id">Entrada em {{ w.name }}</option>
          </select>
          <input v-model="purchase.supplierRef" class="input" placeholder="N.o da fatura do fornecedor" />
        </div>
        <div v-for="(line, index) in purchase.items" :key="index" class="grid grid-cols-[1fr_100px_120px_32px] items-center gap-2">
          <select v-model.number="line.productId" class="input" @change="onProductChange(line)">
            <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }} ({{ p.unit }})</option>
          </select>
          <input v-model.number="line.quantity" class="input" type="number" min="0.001" step="0.001" aria-label="Quantidade" />
          <input v-model.number="line.unitCost" class="input" type="number" min="0" step="0.0001" aria-label="Custo unitario" />
          <button class="text-rose-600" type="button" :disabled="purchase.items.length === 1" aria-label="Remover linha" @click="purchase.items.splice(index, 1)">
            &times;
          </button>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <button
            class="text-sm text-indigo-600 hover:underline"
            type="button"
            @click="purchase.items.push({ productId: products[0].id, quantity: 1, unitCost: Number(products[0].cost) })"
          >
            + linha
          </button>
          <span class="font-semibold">Total {{ money(draftTotal) }}</span>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" type="button" @click="showForm = false">Cancelar</button>
          <button class="btn" type="submit" :disabled="busy">Guardar rascunho</button>
        </div>
      </form>

      <div class="card overflow-x-auto p-0">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th class="px-4 py-3">Data</th>
              <th class="px-4 py-3">N.o</th>
              <th class="px-4 py-3">Fornecedor</th>
              <th class="px-4 py-3">Ref.</th>
              <th class="px-4 py-3">Armazem</th>
              <th class="px-4 py-3">Produtos</th>
              <th class="px-4 py-3 text-right">Total</th>
              <th class="px-4 py-3">Estado</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in purchases" :key="item.id" class="border-b border-slate-100">
              <td class="px-4 py-3 whitespace-nowrap">{{ formatDateTime(item.orderedAt) }}</td>
              <td class="px-4 py-3 whitespace-nowrap">
                {{ purchaseNumber(item) }}
                <span v-if="item.sentAt" class="block text-xs text-slate-500">enviada {{ formatDateTime(item.sentAt) }}</span>
              </td>
              <td class="px-4 py-3 font-medium">{{ item.supplier.name }}</td>
              <td class="px-4 py-3">{{ item.supplierRef ?? '-' }}</td>
              <td class="px-4 py-3">{{ item.warehouse.name }}</td>
              <td class="px-4 py-3 text-slate-600">
                <span v-for="(line, index) in item.items" :key="line.id">
                  {{ index ? ', ' : '' }}{{ qty(line.quantity) }} {{ line.product.name }}<template v-if="item.status === 'PARTIAL'"> ({{ qty(line.receivedQuantity) }} recebido)</template>
                </span>
              </td>
              <td class="px-4 py-3 text-right">{{ money(item.total) }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs whitespace-nowrap" :class="STATUS_CLASSES[item.status]">{{ STATUS_LABELS[item.status] }}</span>
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
                  Enviar
                </button>
                <template v-if="item.status === 'DRAFT'">
                  <button class="text-indigo-600 hover:underline" type="button" @click="editPurchase(item)">Editar</button>
                  <button class="font-semibold text-emerald-700 hover:underline" type="button" @click="startReception(item)">Receber</button>
                  <button class="text-rose-600 hover:underline" type="button" @click="cancel(item)">Cancelar</button>
                </template>
                <template v-if="item.status === 'PARTIAL'">
                  <button class="font-semibold text-emerald-700 hover:underline" type="button" @click="startReception(item)">Receber resto</button>
                  <button class="text-slate-600 hover:underline" type="button" @click="closePurchase(item)">Concluir</button>
                </template>
              </td>
            </tr>
            <tr v-if="!purchases.length">
              <td colspan="9" class="px-4 py-6 text-center text-slate-500">Sem compras</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <form class="card grid gap-3 sm:grid-cols-5" @submit.prevent="addSupplier">
        <input v-model="supplier.name" class="input sm:col-span-2" placeholder="Nome" required />
        <input v-model="supplier.taxId" class="input" placeholder="NIF" />
        <input v-model="supplier.email" class="input" type="email" placeholder="Email" />
        <input v-model="supplier.phone" class="input" placeholder="Telefone" />
        <button class="btn sm:col-span-5 sm:justify-self-end" type="submit" :disabled="busy">Adicionar fornecedor</button>
      </form>
      <div class="card overflow-x-auto p-0">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr><th class="px-4 py-3">Nome</th><th class="px-4 py-3">NIF</th><th class="px-4 py-3">Contacto</th><th class="px-4 py-3"></th></tr>
          </thead>
          <tbody>
            <tr v-for="item in suppliers" :key="item.id" class="border-b border-slate-100" :class="item.active ? '' : 'text-slate-400'">
              <td class="px-4 py-3 font-medium">{{ item.name }}</td>
              <td class="px-4 py-3">{{ item.taxId ?? '-' }}</td>
              <td class="px-4 py-3">{{ [item.email, item.phone].filter(Boolean).join(' · ') || '-' }}</td>
              <td class="px-4 py-3 text-right">
                <button class="text-xs text-indigo-600 hover:underline" type="button" @click="toggleSupplier(item)">
                  {{ item.active ? 'Desativar' : 'Ativar' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

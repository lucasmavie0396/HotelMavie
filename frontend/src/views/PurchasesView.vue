<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Product, Purchase, Supplier, Warehouse } from '@/types';
import { formatDateTime, formatMoney } from '@/utils/format';

const STATUS_LABELS: Record<Purchase['status'], string> = { DRAFT: 'Rascunho', RECEIVED: 'Recebida', CANCELLED: 'Cancelada' };

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

const money = (value: string | number) => formatMoney(value, hotels.currency);
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

const receive = (item: Purchase) =>
  run(async () => {
    if (window.confirm(`Dar entrada em stock da compra a ${item.supplier.name}?`)) {
      await api.post(`/purchases/${item.id}/receive`);
    }
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
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">Compras</h1>
      <div class="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
        <button type="button" class="rounded px-4 py-1.5" :class="tab === 'purchases' ? 'bg-indigo-600 text-white' : ''" @click="tab = 'purchases'">
          Encomendas
        </button>
        <button type="button" class="rounded px-4 py-1.5" :class="tab === 'suppliers' ? 'bg-indigo-600 text-white' : ''" @click="tab = 'suppliers'">
          Fornecedores
        </button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <template v-if="tab === 'purchases'">
      <p v-if="!suppliers.length || !warehouses.length || !products.length" class="text-sm text-slate-500">
        Para registar compras precisas de pelo menos um fornecedor, um armazem e um produto com controlo de stock.
      </p>
      <button v-else-if="!showForm" class="btn" type="button" @click="newPurchase">Nova compra</button>

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
              <td class="px-4 py-3">{{ formatDateTime(item.orderedAt) }}</td>
              <td class="px-4 py-3 font-medium">{{ item.supplier.name }}</td>
              <td class="px-4 py-3">{{ item.supplierRef ?? '-' }}</td>
              <td class="px-4 py-3">{{ item.warehouse.name }}</td>
              <td class="px-4 py-3 text-slate-600">
                {{ item.items.map((line) => `${Number(line.quantity)} ${line.product.name}`).join(', ') }}
              </td>
              <td class="px-4 py-3 text-right">{{ money(item.total) }}</td>
              <td class="px-4 py-3">{{ STATUS_LABELS[item.status] }}</td>
              <td class="space-x-3 px-4 py-3 text-right text-xs whitespace-nowrap">
                <template v-if="item.status === 'DRAFT'">
                  <button class="text-indigo-600 hover:underline" type="button" @click="editPurchase(item)">Editar</button>
                  <button class="font-semibold text-emerald-700 hover:underline" type="button" @click="receive(item)">Receber</button>
                  <button class="text-rose-600 hover:underline" type="button" @click="cancel(item)">Cancelar</button>
                </template>
              </td>
            </tr>
            <tr v-if="!purchases.length">
              <td colspan="8" class="px-4 py-6 text-center text-slate-500">Sem compras</td>
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

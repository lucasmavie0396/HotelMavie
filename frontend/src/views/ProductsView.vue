<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import RecipeEditor from '@/components/RecipeEditor.vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { Outlet, PrepStation, Product, ProductCategory, TaxRate } from '@/types';
import { formatMoney } from '@/utils/format';

const auth = useAuthStore();
const hotels = useHotelsStore();
const products = ref<Product[]>([]);
const categories = ref<ProductCategory[]>([]);
const taxRates = ref<TaxRate[]>([]);
const error = ref('');
const busy = ref(false);
const editingId = ref<number | null>(null);
const recipeFor = ref<Product | null>(null);
const q = ref('');

const canManage = computed(() => auth.user?.role !== 'RECEPTION');
const filtered = computed(() => {
  const term = q.value.trim().toLowerCase();
  return term ? products.value.filter((p) => `${p.name} ${p.sku ?? ''}`.toLowerCase().includes(term)) : products.value;
});

function emptyProduct() {
  return { name: '', sku: '', unit: 'un', categoryId: 0, price: 0, cost: 0, taxRateId: 0, sellable: true, trackStock: false, minStock: 0, active: true };
}

const form = reactive(emptyProduct());
const category = reactive({ name: '', outlet: '' as Outlet | '', prepStation: 'KITCHEN' as PrepStation });
const STATION_LABELS: Record<PrepStation, string> = { KITCHEN: 'Cozinha', BAR: 'Bar', NONE: 'Sem preparacao' };

async function load() {
  try {
    const params = { hotelId: hotels.selectedId };
    const [p, c, t] = await Promise.all([
      api.get<Product[]>('/products', { params }),
      api.get<ProductCategory[]>('/product-categories', { params }),
      api.get<TaxRate[]>('/tax-rates', { params }),
    ]);
    products.value = p.data;
    categories.value = c.data;
    taxRates.value = t.data.filter((rate) => rate.active);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function edit(product: Product) {
  editingId.value = product.id;
  Object.assign(form, {
    name: product.name,
    sku: product.sku ?? '',
    unit: product.unit,
    categoryId: product.categoryId ?? 0,
    price: Number(product.price),
    cost: Number(product.cost),
    taxRateId: product.taxRateId ?? 0,
    sellable: product.sellable,
    trackStock: product.trackStock,
    minStock: Number(product.minStock),
    active: product.active,
  });
}

function reset() {
  editingId.value = null;
  Object.assign(form, emptyProduct());
}

const saveProduct = () =>
  run(async () => {
    const payload = { ...form, sku: form.sku || null, categoryId: form.categoryId || null, taxRateId: form.taxRateId || null };
    if (editingId.value) {
      await api.patch(`/products/${editingId.value}`, payload);
    } else {
      await api.post('/products', { ...payload, hotelId: hotels.selectedId });
    }
    reset();
  });

const addCategory = () =>
  run(async () => {
    await api.post('/product-categories', {
      hotelId: hotels.selectedId,
      name: category.name,
      outlet: category.outlet || null,
      prepStation: category.prepStation,
    });
    Object.assign(category, { name: '', outlet: '', prepStation: 'KITCHEN' });
  });

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">Produtos e ementa</h1>
      <input v-model="q" class="input w-64" placeholder="Procurar produto" />
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div v-if="canManage" class="grid gap-6 lg:grid-cols-3">
      <form class="card grid gap-3 sm:grid-cols-2 lg:col-span-2" @submit.prevent="saveProduct">
        <h2 class="font-semibold sm:col-span-2">{{ editingId ? 'Editar produto' : 'Novo produto' }}</h2>
        <input v-model="form.name" class="input" placeholder="Nome" required />
        <div class="flex gap-2">
          <input v-model="form.sku" class="input" placeholder="Codigo/SKU" />
          <input v-model="form.unit" class="input w-20" placeholder="Unid." />
        </div>
        <select v-model.number="form.categoryId" class="input">
          <option :value="0">Sem categoria</option>
          <option v-for="item in categories" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <select v-model.number="form.taxRateId" class="input">
          <option :value="0">Sem IVA</option>
          <option v-for="rate in taxRates" :key="rate.id" :value="rate.id">{{ rate.name }} ({{ Number(rate.rate) }}%)</option>
        </select>
        <label class="text-sm">Preco de venda (c/ IVA)<input v-model.number="form.price" class="input" type="number" min="0" step="0.01" /></label>
        <label class="text-sm">Custo<input v-model.number="form.cost" class="input" type="number" min="0" step="0.0001" /></label>
        <div class="flex flex-wrap gap-4 text-sm sm:col-span-2">
          <label class="flex items-center gap-2"><input v-model="form.sellable" type="checkbox" />Vende-se no POS</label>
          <label class="flex items-center gap-2"><input v-model="form.trackStock" type="checkbox" />Controla stock</label>
          <label class="flex items-center gap-2"><input v-model="form.active" type="checkbox" />Ativo</label>
          <label v-if="form.trackStock" class="flex items-center gap-2">
            Stock minimo <input v-model.number="form.minStock" class="input w-24" type="number" min="0" step="0.001" />
          </label>
        </div>
        <div class="flex justify-end gap-2 sm:col-span-2">
          <button v-if="editingId" class="btn-secondary" type="button" @click="reset">Cancelar</button>
          <button class="btn" type="submit" :disabled="busy">{{ editingId ? 'Guardar' : 'Criar produto' }}</button>
        </div>
      </form>

      <div class="card space-y-3">
        <h2 class="font-semibold">Categorias</h2>
        <form class="grid grid-cols-2 gap-2" @submit.prevent="addCategory">
          <input v-model="category.name" class="input col-span-2" placeholder="Nova categoria" required />
          <select v-model="category.outlet" class="input" aria-label="Onde se vende">
            <option value="">Restaurante e bar</option>
            <option value="RESTAURANT">So restaurante</option>
            <option value="BAR">So bar</option>
          </select>
          <select v-model="category.prepStation" class="input" aria-label="Onde se prepara">
            <option v-for="(label, value) in STATION_LABELS" :key="value" :value="value">Prepara: {{ label }}</option>
          </select>
          <button class="btn col-span-2" type="submit" :disabled="busy">Adicionar categoria</button>
        </form>
        <ul class="divide-y divide-slate-100 text-sm">
          <li v-for="item in categories" :key="item.id" class="flex justify-between py-1.5">
            {{ item.name }}
            <span class="text-slate-500">
              {{ item.outlet === 'BAR' ? 'Bar' : item.outlet === 'RESTAURANT' ? 'Restaurante' : 'Ambos' }} · {{ STATION_LABELS[item.prepStation] }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <RecipeEditor v-if="recipeFor" :key="recipeFor.id" :product="recipeFor" :ingredients="products" @close="recipeFor = null" />

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">Produto</th>
            <th class="px-4 py-3">Categoria</th>
            <th class="px-4 py-3 text-right">Preco</th>
            <th class="px-4 py-3 text-right">Custo</th>
            <th class="px-4 py-3">Stock</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="product in filtered" :key="product.id" class="border-b border-slate-100" :class="product.active ? '' : 'text-slate-400'">
            <td class="px-4 py-3 font-medium">
              {{ product.name }} <span class="text-xs text-slate-500">{{ product.sku }}</span>
              <span v-if="!product.sellable" class="ml-1 rounded bg-slate-100 px-1 text-xs">so stock</span>
            </td>
            <td class="px-4 py-3">{{ product.category?.name ?? '-' }}</td>
            <td class="px-4 py-3 text-right">{{ formatMoney(product.price, hotels.currency) }}</td>
            <td class="px-4 py-3 text-right">{{ formatMoney(product.cost, hotels.currency) }}</td>
            <td class="px-4 py-3">{{ product.trackStock ? `Sim (min. ${Number(product.minStock)} ${product.unit})` : 'Nao' }}</td>
            <td class="px-4 py-3 text-right">
              <button
                v-if="canManage && product.sellable"
                class="mr-3 text-xs text-indigo-600 hover:underline"
                type="button"
                @click="recipeFor = product"
              >
                Receita
              </button>
              <button v-if="canManage" class="text-xs text-indigo-600 hover:underline" type="button" @click="edit(product)">Editar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

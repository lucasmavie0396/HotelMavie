<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { translated } from '@/i18n';
import ProductImagePicker from '@/components/ProductImagePicker.vue';
import RecipeEditor from '@/components/RecipeEditor.vue';
import { api, errorMessage } from '@/services/api';
import { fileUrl } from '@/services/files';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { Outlet, PrepStation, Printer, Product, ProductCategory, TaxRate } from '@/types';
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
  return { name: '', sku: '', unit: 'un', categoryId: 0, price: 0, cost: 0, taxRateId: 0, sellable: true, trackStock: false, trackExpiry: false, minStock: 0, active: true };
}

const form = reactive(emptyProduct());
const category = reactive({ name: '', outlet: '' as Outlet | '', prepStation: 'KITCHEN' as PrepStation, printerId: 0 });
const printers = ref<Printer[]>([]);
const printerName = (id: number | null) => printers.value.find((printer) => printer.id === id)?.name;
const STATION_LABELS = translated<PrepStation>('labels.prepStation', ['KITCHEN', 'BAR', 'NONE']);
const { t } = useI18n();

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
    printers.value = (await api.get<Printer[]>('/printers', { params })).data;
    await loadNextSku();
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
    trackExpiry: product.trackExpiry,
    minStock: Number(product.minStock),
    active: product.active,
  });
}

function reset() {
  editingId.value = null;
  Object.assign(form, emptyProduct());
}

const notice = ref('');
const editingProduct = computed(() => products.value.find((product) => product.id === editingId.value) ?? null);

async function saveProduct() {
  let createdId: number | null = null;
  notice.value = '';
  await run(async () => {
    const payload = { ...form, sku: form.sku || null, categoryId: form.categoryId || null, taxRateId: form.taxRateId || null };
    if (editingId.value) {
      await api.patch(`/products/${editingId.value}`, payload);
      reset();
    } else {
      createdId = (await api.post<Product>('/products', { ...payload, hotelId: hotels.selectedId })).data.id;
    }
  });
  const created = products.value.find((product) => product.id === createdId);
  if (created) {
    edit(created);
    notice.value = t('products.created', { sku: created.sku });
  }
}

function imageUpdated(updated: Product) {
  const index = products.value.findIndex((product) => product.id === updated.id);
  if (index >= 0) products.value[index] = { ...products.value[index], imageFile: updated.imageFile };
}

const editingCategoryId = ref<number | null>(null);
const nextSku = ref('');

async function loadNextSku() {
  try {
    nextSku.value = (await api.get<{ sku: string }>('/products/next-sku', { params: { hotelId: hotels.selectedId } })).data.sku;
  } catch {
    nextSku.value = '';
  }
}

function editCategory(item: ProductCategory) {
  editingCategoryId.value = item.id;
  Object.assign(category, { name: item.name, outlet: item.outlet ?? '', prepStation: item.prepStation, printerId: item.printerId ?? 0 });
}

function resetCategory() {
  editingCategoryId.value = null;
  Object.assign(category, { name: '', outlet: '', prepStation: 'KITCHEN', printerId: 0 });
}

const saveCategory = () =>
  run(async () => {
    const payload = {
      name: category.name,
      outlet: category.outlet || null,
      prepStation: category.prepStation,
      printerId: category.printerId || null,
    };
    if (editingCategoryId.value) await api.patch(`/product-categories/${editingCategoryId.value}`, payload);
    else await api.post('/product-categories', { ...payload, hotelId: hotels.selectedId });
    resetCategory();
  });

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="products" :title="t('products.title')" :subtitle="t('products.subtitle')">
      <input v-model="q" class="input w-64" :placeholder="t('products.search')" />
    </PageHeader>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <div v-if="canManage" class="grid gap-6 lg:grid-cols-3">
      <form class="card grid gap-3 sm:grid-cols-2 lg:col-span-2" @submit.prevent="saveProduct">
        <h2 class="font-semibold sm:col-span-2">{{ editingId ? t('products.edit') : t('products.new') }}</h2>
        <ProductImagePicker v-if="editingProduct" :key="editingProduct.id" class="sm:col-span-2" :product="editingProduct" @updated="imageUpdated" />
        <p v-else class="text-xs text-slate-500 sm:col-span-2">{{ t('products.photoHint') }}</p>
        <input v-model="form.name" class="input" :placeholder="t('common.name')" required />
        <div class="flex gap-2">
          <input
            v-model="form.sku"
            class="input"
            :placeholder="editingId ? t('products.code') : nextSku ? t('products.auto', { sku: nextSku }) : t('products.autoCode')"
            :title="editingId ? t('products.codeTitle') : t('products.autoTitle')"
          />
          <input v-model="form.unit" class="input w-20" :placeholder="t('products.unit')" />
        </div>
        <select v-model.number="form.categoryId" class="input">
          <option :value="0">{{ t('products.noCategory') }}</option>
          <option v-for="item in categories" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <select v-model.number="form.taxRateId" class="input">
          <option :value="0">{{ t('folio.noVat') }}</option>
          <option v-for="rate in taxRates" :key="rate.id" :value="rate.id">{{ rate.name }} ({{ Number(rate.rate) }}%)</option>
        </select>
        <label class="text-sm">{{ t('products.salePrice') }}<input v-model.number="form.price" class="input" type="number" min="0" step="0.01" /></label>
        <label class="text-sm">{{ t('products.cost') }}<input v-model.number="form.cost" class="input" type="number" min="0" step="0.0001" /></label>
        <div class="flex flex-wrap gap-4 text-sm sm:col-span-2">
          <label class="flex items-center gap-2"><input v-model="form.sellable" type="checkbox" />{{ t('products.sellable') }}</label>
          <label class="flex items-center gap-2"><input v-model="form.trackStock" type="checkbox" />{{ t('products.trackStock') }}</label>
          <label class="flex items-center gap-2"><input v-model="form.active" type="checkbox" />{{ t('common.active') }}</label>
          <label v-if="form.trackStock" class="flex items-center gap-2">
            {{ t('products.minStock') }} <input v-model.number="form.minStock" class="input w-24" type="number" min="0" step="0.001" />
          </label>
          <label v-if="form.trackStock" class="flex items-center gap-2"><input v-model="form.trackExpiry" type="checkbox" />{{ t('products.trackExpiry') }}</label>
        </div>
        <div class="flex justify-end gap-2 sm:col-span-2">
          <button v-if="editingId" class="btn-secondary" type="button" @click="reset">{{ t('common.cancel') }}</button>
          <button class="btn" type="submit" :disabled="busy">{{ editingId ? t('common.save') : t('products.create') }}</button>
        </div>
      </form>

      <div class="card space-y-3">
        <h2 class="font-semibold">{{ t('products.categories') }}</h2>
        <form class="grid grid-cols-2 gap-2" :class="editingCategoryId ? 'rounded-xl bg-indigo-50 p-2 ring-1 ring-indigo-200' : ''" @submit.prevent="saveCategory">
          <p v-if="editingCategoryId" class="col-span-2 text-xs font-semibold text-indigo-700">{{ t('products.editingCategory') }}</p>
          <input v-model="category.name" class="input col-span-2" :placeholder="editingCategoryId ? t('products.categoryName') : t('products.newCategory')" required />
          <select v-model="category.outlet" class="input" :aria-label="t('products.whereSold')">
            <option value="">{{ t('products.both') }}</option>
            <option value="RESTAURANT">{{ t('products.restaurantOnly') }}</option>
            <option value="BAR">{{ t('products.barOnly') }}</option>
          </select>
          <select v-model="category.prepStation" class="input" :aria-label="t('products.whereMade')">
            <option v-for="(label, value) in STATION_LABELS" :key="value" :value="value">{{ t('products.prepares', { station: label }) }}</option>
          </select>
          <select v-model.number="category.printerId" class="input col-span-2" :aria-label="t('products.printer')">
            <option :value="0">{{ t('products.mainPrinter') }}</option>
            <option v-for="printer in printers.filter((p) => p.active)" :key="printer.id" :value="printer.id">{{ t('products.printOn', { name: printer.name }) }}</option>
          </select>
          <button v-if="editingCategoryId" class="btn-secondary" type="button" @click="resetCategory">{{ t('common.cancel') }}</button>
          <button class="btn" :class="editingCategoryId ? '' : 'col-span-2'" type="submit" :disabled="busy">
            {{ editingCategoryId ? t('common.save') : t('products.addCategory') }}
          </button>
        </form>
        <ul class="divide-y divide-slate-100 text-sm">
          <li v-for="item in categories" :key="item.id" class="flex items-start justify-between gap-2 py-2" :class="editingCategoryId === item.id ? 'text-indigo-700' : ''">
            <span class="min-w-0">
              <span class="block font-medium">{{ item.name }}</span>
              <span class="block text-xs text-slate-500">
                {{ item.outlet ? t(`labels.outlet.${item.outlet}`) : t('products.bothShort') }} · {{ STATION_LABELS[item.prepStation] }}
                · {{ item.printerId ? printerName(item.printerId) ?? t('products.printerInactive') : t('products.mainPrinterShort') }}
              </span>
            </span>
            <button class="shrink-0 text-xs text-indigo-600 hover:underline" type="button" @click="editCategory(item)">{{ t('common.edit') }}</button>
          </li>
        </ul>
      </div>
    </div>

    <RecipeEditor v-if="recipeFor" :key="recipeFor.id" :product="recipeFor" :ingredients="products" @close="recipeFor = null" />

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('common.product') }}</th>
            <th class="px-4 py-3">{{ t('products.category') }}</th>
            <th class="px-4 py-3 text-right">{{ t('common.price') }}</th>
            <th class="px-4 py-3 text-right">{{ t('products.cost') }}</th>
            <th class="px-4 py-3">{{ t('products.stock') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="product in filtered" :key="product.id" class="border-b border-slate-100" :class="product.active ? '' : 'text-slate-400'">
            <td class="px-4 py-3 font-medium">
              <span class="flex items-center gap-3">
                <img v-if="product.imageFile" :src="fileUrl(product.imageFile)" alt="" class="size-10 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
                <span v-else class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">{{ product.name.slice(0, 2).toUpperCase() }}</span>
                <span>
                  {{ product.name }} <span class="text-xs text-slate-500">{{ product.sku }}</span>
                  <span v-if="!product.sellable" class="ml-1 rounded bg-slate-100 px-1 text-xs">{{ t('products.stockOnly') }}</span>
                </span>
              </span>
            </td>
            <td class="px-4 py-3">{{ product.category?.name ?? '-' }}</td>
            <td class="px-4 py-3 text-right">{{ formatMoney(product.price, hotels.currency) }}</td>
            <td class="px-4 py-3 text-right">{{ formatMoney(product.cost, hotels.currency) }}</td>
            <td class="px-4 py-3">{{ product.trackStock ? t('products.stockYes', { min: Number(product.minStock), unit: product.unit }) : t('common.no') }}</td>
            <td class="px-4 py-3 text-right">
              <button
                v-if="canManage && product.sellable"
                class="mr-3 text-xs text-indigo-600 hover:underline"
                type="button"
                @click="recipeFor = product"
              >
                {{ t('products.recipe') }}
              </button>
              <button v-if="canManage" class="text-xs text-indigo-600 hover:underline" type="button" @click="edit(product)">{{ t('common.edit') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

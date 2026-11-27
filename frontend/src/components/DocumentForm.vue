<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Guest, InvoiceSummary, Product, Quote, TaxRate } from '@/types';
import { formatMoney } from '@/utils/format';

const props = defineProps<{ kind: 'INVOICE' | 'QUOTE' }>();
const emit = defineEmits<{ close: []; issued: [kind: 'INVOICE' | 'QUOTE', id: number] }>();

interface Line {
  key: number;
  productId: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRateId: number | '';
}

const { t } = useI18n();
const hotels = useHotelsStore();
const invoice = computed(() => props.kind === 'INVOICE');
const taxRates = ref<TaxRate[]>([]);
const customer = reactive({ customerName: '', customerTaxId: '', customerAddress: '', customerEmail: '' });
const guestSearch = ref('');
const guests = ref<Guest[]>([]);
const productSearch = ref('');
const products = ref<Product[]>([]);
const lines = ref<Line[]>([]);
const notes = ref('');
const error = ref('');
const busy = ref(false);
let nextKey = 1;

function inDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const today = inDays(0);
const date = ref(inDays(invoice.value ? 30 : 15));
const activeRates = computed(() => taxRates.value.filter((rate) => rate.active));
const number = (value: string) => Number(String(value).replace(',', '.'));
const money = (value: number | string) => formatMoney(value, hotels.currency);

function lineTotal(line: Line) {
  const gross = Math.round(number(line.unitPrice) * number(line.quantity) * 100) / 100;
  return Math.max(0, gross - (number(line.discount) || 0));
}

const total = computed(() => lines.value.reduce((sum, line) => sum + lineTotal(line), 0));

let guestTimer: ReturnType<typeof setTimeout> | undefined;
watch(guestSearch, (value) => {
  clearTimeout(guestTimer);
  if (value.trim().length < 2) {
    guests.value = [];
    return;
  }
  guestTimer = setTimeout(async () => {
    try {
      guests.value = (await api.get<Guest[]>('/guests', { params: { hotelId: hotels.selectedId, q: value.trim() } })).data.slice(0, 10);
    } catch (e) {
      error.value = errorMessage(e);
    }
  }, 300);
});

let productTimer: ReturnType<typeof setTimeout> | undefined;
watch(productSearch, (value) => {
  clearTimeout(productTimer);
  if (value.trim().length < 2) {
    products.value = [];
    return;
  }
  productTimer = setTimeout(async () => {
    try {
      const found = (await api.get<Product[]>('/products', { params: { hotelId: hotels.selectedId, q: value.trim(), sellable: true } })).data;
      products.value = found.filter((product) => product.active).slice(0, 10);
    } catch (e) {
      error.value = errorMessage(e);
    }
  }, 300);
});

function chooseGuest(guest: Guest) {
  customer.customerName = `${guest.firstName} ${guest.lastName}`.trim();
  customer.customerTaxId = guest.taxId ?? '';
  customer.customerAddress = guest.address ?? '';
  customer.customerEmail = guest.email ?? '';
  guestSearch.value = '';
  guests.value = [];
}

function addProduct(product: Product) {
  lines.value.push({
    key: nextKey++,
    productId: product.id,
    description: product.name,
    quantity: '1',
    unitPrice: String(Number(product.price)).replace('.', ','),
    discount: '',
    taxRateId: product.taxRateId ?? '',
  });
  productSearch.value = '';
  products.value = [];
}

function addFree() {
  const standard = activeRates.value.find((rate) => Number(rate.rate) === 16) ?? activeRates.value[0];
  lines.value.push({ key: nextKey++, productId: null, description: '', quantity: '1', unitPrice: '', discount: '', taxRateId: standard?.id ?? '' });
}

async function issue() {
  error.value = '';
  if (invoice.value && !customer.customerName.trim()) {
    error.value = t('documents.customerRequired');
    return;
  }
  if (!lines.value.length) {
    error.value = t('documents.noLines');
    return;
  }
  const invalid = lines.value.findIndex((line) => !(number(line.quantity) > 0) || !(number(line.unitPrice) >= 0) || line.unitPrice === '' || !line.description.trim() || line.taxRateId === '');
  if (invalid >= 0) {
    error.value = t('documents.invalidLine', { n: invalid + 1 });
    return;
  }
  busy.value = true;
  try {
    const body = {
      hotelId: hotels.selectedId,
      customerName: customer.customerName.trim() || undefined,
      customerTaxId: customer.customerTaxId.trim() || undefined,
      customerAddress: customer.customerAddress.trim() || undefined,
      customerEmail: customer.customerEmail.trim() || undefined,
      notes: notes.value.trim() || undefined,
      lines: lines.value.map((line) => ({
        productId: line.productId ?? undefined,
        description: line.description.trim(),
        quantity: number(line.quantity),
        unitPrice: number(line.unitPrice),
        discount: number(line.discount) || undefined,
        taxRateId: line.taxRateId === '' ? undefined : line.taxRateId,
      })),
    };
    if (invoice.value) {
      const { data } = await api.post<InvoiceSummary>('/invoices', { ...body, dueDate: date.value || undefined });
      emit('issued', 'INVOICE', data.id);
    } else {
      const { data } = await api.post<Quote>('/quotes', { ...body, validUntil: date.value });
      emit('issued', 'QUOTE', data.id);
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    taxRates.value = (await api.get<TaxRate[]>('/tax-rates', { params: { hotelId: hotels.selectedId } })).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center" role="dialog" aria-modal="true" :aria-label="invoice ? t('documents.newInvoice') : t('documents.newQuote')">
    <form class="max-h-[94dvh] w-full max-w-5xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" data-testid="document-form" @submit.prevent="issue">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">{{ invoice ? t('documents.newInvoice') : t('documents.newQuote') }}</h2>
        <button class="btn-icon" type="button" :aria-label="t('common.close')" @click="emit('close')">✕</button>
      </div>
      <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
      <p v-if="invoice" class="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">{{ t('documents.creditHint') }}</p>

      <div class="relative">
        <label class="block text-sm">
          <span class="mb-1 block text-slate-600">{{ t('documents.findGuest') }}</span>
          <input v-model="guestSearch" class="input" :placeholder="t('documents.findGuestPlaceholder')" autocomplete="off" />
        </label>
        <ul v-if="guests.length" class="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          <li v-for="guest in guests" :key="guest.id">
            <button class="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" type="button" @click="chooseGuest(guest)">
              <span class="font-medium">{{ guest.firstName }} {{ guest.lastName }}</span>
              <span class="text-slate-500">{{ guest.taxId ? ` · NUIT ${guest.taxId}` : '' }}{{ guest.phone ? ` · ${guest.phone}` : '' }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div class="grid gap-3 md:grid-cols-4">
        <label class="block text-sm md:col-span-2">
          <span class="mb-1 block text-slate-600">{{ t('invoices.customer') }}{{ invoice ? ' *' : '' }}</span>
          <input v-model="customer.customerName" class="input" maxlength="200" :placeholder="invoice ? '' : t('documents.finalConsumer')" />
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-slate-600">{{ t('purchases.taxId') }}</span>
          <input v-model="customer.customerTaxId" class="input" maxlength="30" inputmode="numeric" />
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-slate-600">{{ invoice ? t('documents.dueDate') : t('documents.validUntil') }}</span>
          <input v-model="date" class="input" type="date" :min="today" :required="!invoice" />
        </label>
        <label class="block text-sm md:col-span-2">
          <span class="mb-1 block text-slate-600">{{ t('documents.address') }}</span>
          <input v-model="customer.customerAddress" class="input" maxlength="255" />
        </label>
        <label class="block text-sm md:col-span-2">
          <span class="mb-1 block text-slate-600">{{ t('common.email') }}</span>
          <input v-model="customer.customerEmail" class="input" type="email" maxlength="150" />
        </label>
      </div>

      <div class="flex flex-wrap items-end gap-2">
        <div class="relative min-w-72 flex-1">
          <label class="block text-sm">
            <span class="mb-1 block text-slate-600">{{ t('documents.addProduct') }}</span>
            <input v-model="productSearch" class="input" :placeholder="t('documents.productPlaceholder')" autocomplete="off" />
          </label>
          <ul v-if="products.length" class="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            <li v-for="product in products" :key="product.id">
              <button class="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50" type="button" @click="addProduct(product)">
                <span>{{ product.name }}<span v-if="product.sku" class="text-slate-500"> · {{ product.sku }}</span></span>
                <span class="tabular-nums">{{ money(product.price) }}</span>
              </button>
            </li>
          </ul>
        </div>
        <button class="btn-secondary" type="button" @click="addFree">+ {{ t('documents.freeLine') }}</button>
      </div>

      <div v-if="lines.length" class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="px-2 py-2">{{ t('documents.description') }}</th>
              <th class="w-24 px-2 py-2">{{ t('documents.quantity') }}</th>
              <th class="w-32 px-2 py-2">{{ t('documents.priceWithVat') }}</th>
              <th class="w-28 px-2 py-2">{{ t('documents.discount') }}</th>
              <th class="w-40 px-2 py-2">{{ t('documents.vat') }}</th>
              <th class="w-32 px-2 py-2 text-right">{{ t('common.total') }}</th>
              <th class="w-12 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="(line, index) in lines" :key="line.key">
              <td class="px-2 py-1"><input v-model="line.description" class="input" maxlength="200" :aria-label="t('documents.lineDescription', { n: index + 1 })" /></td>
              <td class="px-2 py-1"><input v-model="line.quantity" class="input text-right" inputmode="decimal" :aria-label="t('documents.lineQuantity', { n: index + 1 })" /></td>
              <td class="px-2 py-1"><input v-model="line.unitPrice" class="input text-right" inputmode="decimal" :aria-label="t('documents.linePrice', { n: index + 1 })" /></td>
              <td class="px-2 py-1"><input v-model="line.discount" class="input text-right" inputmode="decimal" placeholder="0" :aria-label="t('documents.lineDiscount', { n: index + 1 })" /></td>
              <td class="px-2 py-1">
                <select v-model="line.taxRateId" class="input" :aria-label="t('documents.lineVat', { n: index + 1 })">
                  <option value="">-</option>
                  <option v-for="rate in activeRates" :key="rate.id" :value="rate.id">{{ rate.name }} ({{ Number(rate.rate) }}%)</option>
                </select>
              </td>
              <td class="px-2 py-1 text-right font-medium tabular-nums">{{ money(lineTotal(line)) }}</td>
              <td class="px-2 py-1">
                <button class="btn-icon text-rose-600" type="button" :aria-label="t('documents.removeLine', { n: index + 1 })" @click="lines.splice(index, 1)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <label class="block text-sm">
        <span class="mb-1 block text-slate-600">{{ t('documents.notes') }}</span>
        <textarea v-model="notes" class="input min-h-16" maxlength="1000" rows="2"></textarea>
      </label>

      <div class="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-3">
        <span class="mr-auto text-sm text-slate-600">{{ t('documents.expectedTotal') }} <strong class="tabular-nums">{{ money(total) }}</strong> ({{ t('documents.vatIncluded') }})</span>
        <button class="btn-secondary" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn" type="submit" :disabled="busy">{{ invoice ? t('documents.issueInvoice') : t('documents.issueQuote') }}</button>
      </div>
    </form>
  </div>
</template>

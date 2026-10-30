<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { translated } from '@/i18n';
import PaymentTypesTab from '@/components/settings/PaymentTypesTab.vue';
import PrintersTab from '@/components/settings/PrintersTab.vue';
import PublicSiteTab from '@/components/settings/PublicSiteTab.vue';
import TablesTab from '@/components/settings/TablesTab.vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { InvoiceType, TaxRate } from '@/types';
import { formatDateTime, INVOICE_TYPE_LABELS, todayIso } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const taxRates = ref<TaxRate[]>([]);
const error = ref('');
const saved = ref('');
const busy = ref(false);

type Tab = 'fiscal' | 'site' | 'taxes' | 'payments' | 'printers' | 'tables' | 'at' | 'emails';
const TABS: { value: Tab; label: string }[] = [
  { value: 'fiscal', label: 'settings.tabs.fiscal' },
  { value: 'site', label: 'settings.tabs.site' },
  { value: 'taxes', label: 'settings.tabs.taxes' },
  { value: 'payments', label: 'settings.tabs.payments' },
  { value: 'printers', label: 'settings.tabs.printers' },
  { value: 'tables', label: 'settings.tabs.tables' },
  { value: 'at', label: 'settings.tabs.at' },
  { value: 'emails', label: 'settings.tabs.emails' },
];
const route = useRoute();
const router = useRouter();
const tab = ref<Tab>(TABS.some((item) => item.value === route.query.tab) ? (route.query.tab as Tab) : 'fiscal');

function selectTab(value: Tab) {
  tab.value = value;
  error.value = '';
  saved.value = '';
  router.replace({ query: { ...route.query, tab: value } });
}

const fiscal = reactive({ legalName: '', taxId: '', invoiceFooter: '', ticketFooter: '', accommodationTaxRateId: 0, city: '', postalCode: '', country: 'PT' });
const series = ref<{ id: number; type: InvoiceType; code: string; nextNumber: number; atValidationCode: string | null }[]>([]);
const seriesCodes = reactive<Record<number, string>>({});
const atStatus = ref<{ certified: boolean; certificateNumber: string } | null>(null);
const saft = reactive({ from: `${new Date().getFullYear()}-01-01`, to: todayIso() });
const isAdmin = computed(() => auth.user?.role === 'ADMIN');

const CATEGORY_LABELS = translated<TaxRate['atCategory']>('settings.categories', ['RED', 'INT', 'NOR', 'ISE']);
const emails = ref<{ smtpConfigured: boolean; items: { id: number; kind: string; recipient: string; subject: string; status: string; error: string | null; createdAt: string }[] } | null>(null);

const EMAIL_KINDS = translated('settings.emailKinds', ['BOOKING_REQUEST', 'BOOKING_ALERT', 'BOOKING_CONFIRMED', 'DEPOSIT_CONFIRMED', 'INVOICE', 'PASSWORD_RESET', 'PURCHASE_ORDER'] as const) as Record<string, string>;
const rate = reactive({ name: '', rate: 23, atCategory: 'NOR' as TaxRate['atCategory'], exemptionReason: '', exemptionCode: '' });

async function load() {
  try {
    taxRates.value = (await api.get<TaxRate[]>('/tax-rates', { params: { hotelId: hotels.selectedId } })).data;
    emails.value = (await api.get('/email-logs', { params: { hotelId: hotels.selectedId } })).data;
    series.value = (await api.get('/invoice-series', { params: { hotelId: hotels.selectedId } })).data;
    atStatus.value = (await api.get('/at/status')).data;
    const hotel = hotels.selected;
    Object.assign(fiscal, {
      legalName: hotel?.legalName ?? '',
      taxId: hotel?.taxId ?? '',
      invoiceFooter: hotel?.invoiceFooter ?? '',
      ticketFooter: hotel?.ticketFooter ?? '',
      accommodationTaxRateId: hotel?.accommodationTaxRateId ?? 0,
      city: hotel?.city ?? '',
      postalCode: hotel?.postalCode ?? '',
      country: hotel?.country ?? 'PT',
    });
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: () => Promise<unknown>, message: string) {
  busy.value = true;
  error.value = '';
  saved.value = '';
  try {
    await action();
    saved.value = message;
    await hotels.load(true);
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const saveFiscal = () =>
  run(
    () =>
      api.patch(`/hotels/${hotels.selectedId}`, {
        legalName: fiscal.legalName || undefined,
        taxId: fiscal.taxId || undefined,
        invoiceFooter: fiscal.invoiceFooter || undefined,
        ticketFooter: fiscal.ticketFooter || null,
        accommodationTaxRateId: fiscal.accommodationTaxRateId || null,
        city: fiscal.city || undefined,
        postalCode: fiscal.postalCode || undefined,
        country: fiscal.country.toUpperCase() || undefined,
      }),
    t('settings.fiscalSaved'),
  );

const addRate = () =>
  run(
    () =>
      api.post('/tax-rates', {
        hotelId: hotels.selectedId,
        name: rate.name,
        rate: rate.rate,
        atCategory: rate.rate === 0 ? undefined : rate.atCategory,
        exemptionReason: rate.exemptionReason || undefined,
        exemptionCode: rate.exemptionCode.toUpperCase() || undefined,
      }),
    t('settings.rateCreated'),
  ).then(() => Object.assign(rate, { name: '', rate: 23, atCategory: 'NOR', exemptionReason: '', exemptionCode: '' }));

const createSeries = () =>
  run(async () => {
    for (const type of ['INVOICE', 'INVOICE_RECEIPT', 'CREDIT_NOTE'] as InvoiceType[]) {
      await api.post('/invoice-series', { hotelId: hotels.selectedId, type });
    }
  }, t('settings.seriesCreated'));

const saveSeriesCode = (id: number) =>
  run(() => api.patch(`/invoice-series/${id}`, { atValidationCode: (seriesCodes[id] ?? '').trim().toUpperCase() }), t('settings.codeSaved'));

async function download(path: string, params: Record<string, unknown>, fallbackName: string) {
  error.value = '';
  try {
    const response = await api.get<Blob>(path, { params, responseType: 'blob' });
    const name = /filename="([^"]+)"/.exec(response.headers['content-disposition'] ?? '')?.[1] ?? fallbackName;
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = e instanceof Error && 'response' in e ? await blobError(e) : errorMessage(e);
  }
}

async function blobError(e: unknown) {
  const data = (e as { response?: { data?: Blob } }).response?.data;
  try {
    return data ? (JSON.parse(await data.text()).message as string) : errorMessage(e);
  } catch {
    return errorMessage(e);
  }
}

const toggleRate = (item: TaxRate) =>
  run(() => api.patch(`/tax-rates/${item.id}`, { active: !item.active }), item.active ? t('settings.rateOff') : t('settings.rateOn'));

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="settings" :title="t('nav.settings')" :subtitle="hotels.selected?.name" />

    <nav class="flex flex-wrap gap-1 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-100" :aria-label="t('settings.tabsLabel')">
      <button
        v-for="item in TABS"
        :key="item.value"
        type="button"
        class="rounded-xl px-4 py-2 text-sm transition"
        :class="tab === item.value ? 'bg-gradient-to-r from-indigo-600 to-violet-600 font-medium text-white shadow' : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'"
        @click="selectTab(item.value)"
      >
        {{ t(item.label) }}
      </button>
    </nav>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="saved" class="text-sm text-emerald-700">{{ saved }}</p>

    <PublicSiteTab v-if="tab === 'site'" />
    <PaymentTypesTab v-if="tab === 'payments'" />
    <PrintersTab v-if="tab === 'printers'" />
    <TablesTab v-if="tab === 'tables'" />

    <form v-if="tab === 'fiscal'" class="card grid gap-3 sm:grid-cols-2" @submit.prevent="saveFiscal">
      <h2 class="font-semibold sm:col-span-2">{{ t('settings.fiscal') }}</h2>
      <input v-model="fiscal.legalName" class="input" :placeholder="t('settings.legalName')" />
      <input v-model="fiscal.taxId" class="input" :placeholder="t('settings.taxId')" />
      <label class="text-sm sm:col-span-2">
        {{ t('settings.lodgingVat') }}
        <select v-model.number="fiscal.accommodationTaxRateId" class="input">
          <option :value="0">{{ t('folio.noVat') }}</option>
          <option v-for="item in taxRates.filter((r) => r.active)" :key="item.id" :value="item.id">
            {{ item.name }} ({{ Number(item.rate) }}%)
          </option>
        </select>
      </label>
      <input v-model="fiscal.city" class="input" :placeholder="t('settings.city')" />
      <div class="flex gap-2">
        <input v-model="fiscal.postalCode" class="input" :placeholder="t('settings.postalCode')" />
        <input v-model="fiscal.country" class="input w-20" maxlength="2" placeholder="PT" :aria-label="t('settings.country')" />
      </div>
      <textarea v-model="fiscal.invoiceFooter" class="input sm:col-span-2" rows="2" :placeholder="t('settings.invoiceFooter')" />
      <input v-model="fiscal.ticketFooter" class="input sm:col-span-2" maxlength="255" :placeholder="t('settings.ticketFooter')" />
      <div class="flex justify-end sm:col-span-2">
        <button class="btn" type="submit" :disabled="busy">{{ t('common.save') }}</button>
      </div>
    </form>

    <div v-if="tab === 'taxes'" class="card space-y-4">
      <h2 class="font-semibold">{{ t('settings.vatRates') }}</h2>
      <form class="grid gap-3 sm:grid-cols-6" @submit.prevent="addRate">
        <input v-model="rate.name" class="input sm:col-span-2" :placeholder="t('settings.rateName')" required />
        <input v-model.number="rate.rate" class="input" type="number" min="0" max="100" step="0.01" placeholder="%" required />
        <select v-if="rate.rate !== 0" v-model="rate.atCategory" class="input sm:col-span-2" :aria-label="t('settings.atCategory')">
          <option value="RED">{{ CATEGORY_LABELS.RED }} (RED)</option>
          <option value="INT">{{ CATEGORY_LABELS.INT }} (INT)</option>
          <option value="NOR">{{ CATEGORY_LABELS.NOR }} (NOR)</option>
        </select>
        <template v-else>
          <input v-model="rate.exemptionReason" class="input" :placeholder="t('settings.exemptionReason')" required />
          <input v-model="rate.exemptionCode" class="input" :placeholder="t('settings.exemptionCode')" pattern="[Mm]\d{2}" required />
        </template>
        <button class="btn" type="submit" :disabled="busy">{{ t('common.add') }}</button>
      </form>
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr><th class="py-2">{{ t('common.name') }}</th><th class="py-2">{{ t('settings.rate') }}</th><th class="py-2">{{ t('settings.atCategory') }}</th><th class="py-2">{{ t('settings.exemption') }}</th><th class="py-2">{{ t('common.status') }}</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="item in taxRates" :key="item.id" class="border-b border-slate-100" :class="item.active ? '' : 'text-slate-400'">
            <td class="py-2">{{ item.name }}</td>
            <td class="py-2">{{ Number(item.rate) }}%</td>
            <td class="py-2">{{ CATEGORY_LABELS[item.atCategory] }}</td>
            <td class="py-2">{{ item.exemptionCode ? `${item.exemptionCode} · ${item.exemptionReason}` : '-' }}</td>
            <td class="py-2">{{ item.active ? t('settings.activeF') : t('settings.inactiveF') }}</td>
            <td class="py-2 text-right">
              <button class="text-xs text-indigo-600 hover:underline" type="button" @click="toggleRate(item)">
                {{ item.active ? t('purchases.deactivate') : t('purchases.activate') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="tab === 'at'" class="card space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">{{ t('settings.tabs.at') }}</h2>
        <span
          v-if="atStatus"
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          :class="atStatus.certified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
        >
          {{ atStatus.certified ? `Certificado n.o ${atStatus.certificateNumber}/AT` : 'Software nao certificado' }}
        </span>
      </div>
      <p class="text-sm text-slate-600">
        {{ t('settings.atHint') }}
      </p>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary" type="button" :disabled="busy" @click="createSeries">{{ t('settings.createSeries') }}</button>
        <button
          v-if="isAdmin"
          class="btn-secondary"
          type="button"
          @click="download('/at/public-key', {}, 'mavie-hgest-public-key.pem')"
        >
          {{ t('settings.publicKey') }}
        </button>
      </div>
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr><th class="py-2">{{ t('settings.series') }}</th><th class="py-2">{{ t('guest.document') }}</th><th class="py-2">{{ t('settings.nextNumber') }}</th><th class="py-2">{{ t('settings.atCode') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in series" :key="item.id" class="border-b border-slate-100">
            <td class="py-2 font-medium">{{ item.code }}</td>
            <td class="py-2">{{ INVOICE_TYPE_LABELS[item.type] }}</td>
            <td class="py-2">{{ item.nextNumber }}</td>
            <td class="py-2">
              <span v-if="item.atValidationCode" class="font-mono">{{ item.atValidationCode }}</span>
              <form v-else-if="item.nextNumber === 1" class="flex gap-2" @submit.prevent="saveSeriesCode(item.id)">
                <input v-model="seriesCodes[item.id]" class="input w-40 font-mono uppercase" :placeholder="t('settings.atCodeExample')" minlength="8" required />
                <button class="btn-secondary" type="submit" :disabled="busy">{{ t('folio.register') }}</button>
              </form>
              <span v-else class="text-rose-600">{{ t('settings.noAtcud') }}</span>
            </td>
          </tr>
          <tr v-if="!series.length"><td colspan="4" class="py-3 text-slate-500">{{ t('settings.noSeries') }}</td></tr>
        </tbody>
      </table>
      <form class="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-4" @submit.prevent="download('/saft', { hotelId: hotels.selectedId, ...saft }, 'saft.xml')">
        <label class="text-sm">{{ t('common.from') }}<input v-model="saft.from" class="input" type="date" required /></label>
        <label class="text-sm">{{ t('common.to') }}<input v-model="saft.to" class="input" type="date" required /></label>
        <button class="btn" type="submit">{{ t('settings.exportSaft') }}</button>
      </form>
    </div>

    <div v-if="tab === 'emails' && emails" class="card space-y-3">
      <h2 class="font-semibold">{{ t('settings.tabs.emails') }}</h2>
      <p v-if="!emails.smtpConfigured" class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
        {{ t('settings.smtpHint') }}
      </p>
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr><th class="py-2">{{ t('common.date') }}</th><th class="py-2">{{ t('rooms.type') }}</th><th class="py-2">{{ t('settings.to') }}</th><th class="py-2">{{ t('common.status') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in emails.items" :key="item.id" class="border-b border-slate-100">
            <td class="py-2">{{ formatDateTime(item.createdAt) }}</td>
            <td class="py-2">{{ EMAIL_KINDS[item.kind] ?? item.kind }}</td>
            <td class="py-2">{{ item.recipient }}</td>
            <td class="py-2" :title="item.error ?? ''" :class="item.status === 'FAILED' ? 'text-rose-600' : item.status === 'SENT' ? 'text-emerald-700' : 'text-slate-500'">
              {{ item.status === 'SENT' ? t('settings.sent') : item.status === 'FAILED' ? t('settings.failed') : t('settings.logged') }}
            </td>
          </tr>
          <tr v-if="!emails.items.length"><td colspan="4" class="py-3 text-slate-500">{{ t('settings.noEmails') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

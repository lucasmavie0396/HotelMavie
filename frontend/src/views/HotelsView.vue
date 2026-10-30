<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Hotel } from '@/types';

interface DomainCheck {
  domain: string;
  target: string | null;
  targetIps: string[];
  ok: boolean;
  records: { name: string; a: string[]; aaaa: string[]; cname: string[]; ok: boolean; exists: boolean }[];
  instructions: { type: string; name: string; value: string }[];
}

const { t } = useI18n();
const hotels = useHotelsStore();
const error = ref('');
const saving = ref(false);
const editingId = ref<number | null>(null);
const check = ref<DomainCheck | null>(null);
const checking = ref(false);

function emptyForm() {
  return { name: '', publicSlug: '', publicEnabled: false, customDomain: '', currency: 'EUR', email: '', phone: '', address: '' };
}

const form = reactive(emptyForm());
const editing = computed(() => hotels.hotels.find((hotel) => hotel.id === editingId.value) ?? null);
const domainPreview = computed(() =>
  form.customDomain
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, ''),
);

function edit(hotel: Hotel) {
  editingId.value = hotel.id;
  check.value = null;
  Object.assign(form, {
    name: hotel.name,
    publicSlug: hotel.publicSlug ?? '',
    publicEnabled: hotel.publicEnabled,
    customDomain: hotel.customDomain ?? '',
    currency: hotel.currency,
    email: hotel.email ?? '',
    phone: hotel.phone ?? '',
    address: hotel.address ?? '',
  });
}

function reset() {
  editingId.value = null;
  check.value = null;
  Object.assign(form, emptyForm());
}

async function save() {
  saving.value = true;
  error.value = '';
  const payload = {
    ...form,
    currency: form.currency.toUpperCase(),
    publicSlug: form.publicSlug || undefined,
    customDomain: form.customDomain.trim() || null,
    email: form.email || undefined,
    phone: form.phone || undefined,
    address: form.address || undefined,
  };
  try {
    if (editingId.value) {
      await api.patch(`/hotels/${editingId.value}`, payload);
    } else {
      await api.post('/hotels', payload);
    }
    reset();
    await hotels.load(true);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function verify(hotel: Hotel) {
  checking.value = true;
  error.value = '';
  try {
    check.value = (await api.get<DomainCheck>(`/hotels/${hotel.id}/domain-check`)).data;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="hotels" :subtitle="t('hotels.subtitle')" />

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <form class="card grid gap-3 sm:grid-cols-4" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-4">{{ editingId ? t('hotels.edit') : t('hotels.new') }}</h2>
      <input v-model="form.name" class="input sm:col-span-2" :placeholder="t('hotels.name')" required />
      <input v-model="form.currency" class="input" :placeholder="t('hotels.currencyHint')" maxlength="3" required />
      <input v-model="form.email" class="input" type="email" placeholder="Email" />
      <input v-model="form.phone" class="input" :placeholder="t('common.phone')" />
      <input v-model="form.address" class="input sm:col-span-3" :placeholder="t('hotels.address')" />

      <fieldset class="grid gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100 sm:col-span-4 sm:grid-cols-3">
        <legend class="px-1 text-sm font-semibold text-slate-700">{{ t('hotels.publicSite') }}</legend>
        <label class="text-sm">
          {{ t('hotels.slug') }}
          <span class="mt-1 flex items-center rounded-lg border border-slate-300 bg-white pl-3 text-sm text-slate-500">
            /h/<input v-model="form.publicSlug" class="w-full rounded-r-lg border-0 bg-transparent px-1 py-2 text-slate-800 focus:ring-0 focus:outline-none" placeholder="hotel-mavie" />
          </span>
        </label>
        <label class="text-sm sm:col-span-2">
          {{ t('hotels.customDomainOptional') }}
          <input v-model="form.customDomain" class="input mt-1" placeholder="www.hotelmavie.co.mz" maxlength="253" />
          <span v-if="domainPreview" class="mt-1 block text-xs text-slate-500">
            {{ t('hotels.opensAt') }} <strong>https://{{ domainPreview }}</strong> {{ t('hotels.afterDns') }}
          </span>
        </label>
        <label class="flex items-center gap-2 text-sm sm:col-span-3">
          <input v-model="form.publicEnabled" type="checkbox" />
          {{ t('hotels.publicActive') }}
        </label>
      </fieldset>

      <div class="flex justify-end gap-2 sm:col-span-4">
        <button v-if="editingId" class="btn-secondary" type="button" @click="reset">{{ t('common.cancel') }}</button>
        <button class="btn" type="submit" :disabled="saving">{{ editingId ? t('common.save') : t('hotels.add') }}</button>
      </div>
    </form>

    <div v-if="editing?.customDomain" class="card space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">{{ t('hotels.domain') }} {{ editing.customDomain }}</h2>
        <button class="btn-secondary" type="button" :disabled="checking" @click="verify(editing)">{{ checking ? t('hotels.checking') : t('hotels.checkDns') }}</button>
      </div>
      <template v-if="check">
        <p
          class="rounded-lg px-3 py-2 text-sm"
          :class="!check.target ? 'bg-amber-50 text-amber-800' : check.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'"
        >
          <template v-if="!check.target">
            {{ t('hotels.noTarget') }}
          </template>
          <template v-else-if="check.ok">{{ t('hotels.dnsOk', { target: check.target }) }}</template>
          <template v-else>{{ t('hotels.dnsMissing', { target: check.target }) }}</template>
        </p>
        <table v-if="check.instructions.length" class="w-full text-left text-sm">
          <thead class="text-xs text-slate-500 uppercase">
            <tr><th class="py-1">{{ t('rooms.type') }}</th><th class="py-1">{{ t('common.name') }}</th><th class="py-1">{{ t('common.value') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in check.instructions" :key="`${item.type}${item.name}${item.value}`" class="border-t border-slate-100">
              <td class="py-1.5 font-mono">{{ item.type }}</td>
              <td class="py-1.5 font-mono">{{ item.name }}</td>
              <td class="py-1.5 font-mono">{{ item.value }}</td>
            </tr>
          </tbody>
        </table>
        <ul class="space-y-1 text-xs text-slate-600">
          <li v-for="record in check.records" :key="record.name">
            <span :class="record.ok ? 'text-emerald-700' : 'text-slate-500'">{{ record.ok ? '✓' : '•' }}</span>
            <span class="font-mono">{{ record.name }}</span>:
            {{ record.exists ? [...record.cname.map((value) => `CNAME ${value}`), ...record.a.map((value) => `A ${value}`), ...record.aaaa.map((value) => `AAAA ${value}`)].join(', ') : t('hotels.noRecords') }}
          </li>
        </ul>
        <p class="text-xs text-slate-500">
          {{ t('hotels.dnsHint') }}
        </p>
      </template>
    </div>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('common.name') }}</th>
            <th class="px-4 py-3">{{ t('hotels.currency') }}</th>
            <th class="px-4 py-3">{{ t('hotels.publicSiteShort') }}</th>
            <th class="px-4 py-3">{{ t('hotels.customDomain') }}</th>
            <th class="px-4 py-3">{{ t('hotels.contact') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="hotel in hotels.hotels" :key="hotel.id" class="border-b border-slate-100 last:border-0">
            <td class="px-4 py-3 font-medium">{{ hotel.name }}</td>
            <td class="px-4 py-3">{{ hotel.currency }}</td>
            <td class="px-4 py-3">
              <RouterLink
                v-if="hotel.publicSlug && hotel.publicEnabled"
                :to="{ name: 'public-hotel', params: { slug: hotel.publicSlug } }"
                class="text-indigo-600 hover:underline"
              >
                /h/{{ hotel.publicSlug }}
              </RouterLink>
              <span v-else class="text-slate-400">{{ t('common.inactive') }}</span>
            </td>
            <td class="px-4 py-3">
              <a v-if="hotel.customDomain" :href="`https://${hotel.customDomain}`" target="_blank" rel="noopener" class="text-indigo-600 hover:underline">
                {{ hotel.customDomain }}
              </a>
              <span v-else class="text-slate-400">-</span>
            </td>
            <td class="px-4 py-3">{{ hotel.email ?? hotel.phone ?? '-' }}</td>
            <td class="px-4 py-3 text-right">
              <button class="text-xs text-indigo-600 hover:underline" type="button" @click="edit(hotel)">{{ t('common.edit') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

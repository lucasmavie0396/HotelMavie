<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { TaxRate } from '@/types';
import { formatDateTime } from '@/utils/format';

const hotels = useHotelsStore();
const taxRates = ref<TaxRate[]>([]);
const error = ref('');
const saved = ref('');
const busy = ref(false);

const fiscal = reactive({ legalName: '', taxId: '', invoiceFooter: '', accommodationTaxRateId: 0 });
const emails = ref<{ smtpConfigured: boolean; items: { id: number; kind: string; recipient: string; subject: string; status: string; error: string | null; createdAt: string }[] } | null>(null);

const EMAIL_KINDS: Record<string, string> = {
  BOOKING_REQUEST: 'Pedido de reserva (hospede)',
  BOOKING_ALERT: 'Nova reserva (hotel)',
  BOOKING_CONFIRMED: 'Reserva confirmada',
  INVOICE: 'Fatura',
};
const rate = reactive({ name: '', rate: 0, exemptionReason: '' });

async function load() {
  try {
    taxRates.value = (await api.get<TaxRate[]>('/tax-rates', { params: { hotelId: hotels.selectedId } })).data;
    emails.value = (await api.get('/email-logs', { params: { hotelId: hotels.selectedId } })).data;
    const hotel = hotels.selected;
    Object.assign(fiscal, {
      legalName: hotel?.legalName ?? '',
      taxId: hotel?.taxId ?? '',
      invoiceFooter: hotel?.invoiceFooter ?? '',
      accommodationTaxRateId: hotel?.accommodationTaxRateId ?? 0,
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
        accommodationTaxRateId: fiscal.accommodationTaxRateId || null,
      }),
    'Dados fiscais guardados',
  );

const addRate = () =>
  run(
    () =>
      api.post('/tax-rates', {
        hotelId: hotels.selectedId,
        name: rate.name,
        rate: rate.rate,
        exemptionReason: rate.exemptionReason || undefined,
      }),
    'Taxa criada',
  ).then(() => Object.assign(rate, { name: '', rate: 0, exemptionReason: '' }));

const toggleRate = (item: TaxRate) =>
  run(() => api.patch(`/tax-rates/${item.id}`, { active: !item.active }), item.active ? 'Taxa desativada' : 'Taxa ativada');

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <h1 class="text-2xl font-semibold">Configuracao · {{ hotels.selected?.name }}</h1>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="saved" class="text-sm text-emerald-700">{{ saved }}</p>

    <form class="card grid gap-3 sm:grid-cols-2" @submit.prevent="saveFiscal">
      <h2 class="font-semibold sm:col-span-2">Dados fiscais</h2>
      <input v-model="fiscal.legalName" class="input" placeholder="Denominacao social" />
      <input v-model="fiscal.taxId" class="input" placeholder="NIF do hotel" />
      <label class="text-sm sm:col-span-2">
        IVA do alojamento
        <select v-model.number="fiscal.accommodationTaxRateId" class="input">
          <option :value="0">Sem IVA</option>
          <option v-for="item in taxRates.filter((r) => r.active)" :key="item.id" :value="item.id">
            {{ item.name }} ({{ Number(item.rate) }}%)
          </option>
        </select>
      </label>
      <textarea v-model="fiscal.invoiceFooter" class="input sm:col-span-2" rows="2" placeholder="Rodape das faturas (IBAN, condicoes...)" />
      <div class="flex justify-end sm:col-span-2">
        <button class="btn" type="submit" :disabled="busy">Guardar</button>
      </div>
    </form>

    <div class="card space-y-4">
      <h2 class="font-semibold">Taxas de IVA</h2>
      <form class="grid gap-3 sm:grid-cols-4" @submit.prevent="addRate">
        <input v-model="rate.name" class="input" placeholder="Nome (ex.: Taxa normal)" required />
        <input v-model.number="rate.rate" class="input" type="number" min="0" max="100" step="0.01" placeholder="%" required />
        <input v-model="rate.exemptionReason" class="input" placeholder="Motivo de isencao (se 0%)" :required="rate.rate === 0" />
        <button class="btn" type="submit" :disabled="busy">Adicionar taxa</button>
      </form>
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr><th class="py-2">Nome</th><th class="py-2">Taxa</th><th class="py-2">Isencao</th><th class="py-2">Estado</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="item in taxRates" :key="item.id" class="border-b border-slate-100" :class="item.active ? '' : 'text-slate-400'">
            <td class="py-2">{{ item.name }}</td>
            <td class="py-2">{{ Number(item.rate) }}%</td>
            <td class="py-2">{{ item.exemptionReason ?? '-' }}</td>
            <td class="py-2">{{ item.active ? 'Ativa' : 'Inativa' }}</td>
            <td class="py-2 text-right">
              <button class="text-xs text-indigo-600 hover:underline" type="button" @click="toggleRate(item)">
                {{ item.active ? 'Desativar' : 'Ativar' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="emails" class="card space-y-3">
      <h2 class="font-semibold">Emails</h2>
      <p v-if="!emails.smtpConfigured" class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
        O servidor de email (SMTP) nao esta configurado: os emails ficam registados mas nao sao enviados. Configura SMTP_HOST,
        SMTP_PORT, SMTP_USER, SMTP_PASS e MAIL_FROM no backend/.env. Para avisos de novas reservas, preenche o email do hotel em Hoteis.
      </p>
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-slate-600">
          <tr><th class="py-2">Data</th><th class="py-2">Tipo</th><th class="py-2">Para</th><th class="py-2">Estado</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in emails.items" :key="item.id" class="border-b border-slate-100">
            <td class="py-2">{{ formatDateTime(item.createdAt) }}</td>
            <td class="py-2">{{ EMAIL_KINDS[item.kind] ?? item.kind }}</td>
            <td class="py-2">{{ item.recipient }}</td>
            <td class="py-2" :title="item.error ?? ''" :class="item.status === 'FAILED' ? 'text-rose-600' : item.status === 'SENT' ? 'text-emerald-700' : 'text-slate-500'">
              {{ item.status === 'SENT' ? 'Enviado' : item.status === 'FAILED' ? 'Falhou' : 'So registado' }}
            </td>
          </tr>
          <tr v-if="!emails.items.length"><td colspan="4" class="py-3 text-slate-500">Ainda nao houve emails</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

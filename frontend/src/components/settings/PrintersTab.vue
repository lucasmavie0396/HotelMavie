<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { translated } from '@/i18n';
import { api, errorMessage } from '@/services/api';
import { agentUrl, DEFAULT_AGENT_URL, listLocalPrinters, previewPdfFrom, printDocument, printerBaseName, setAgentUrl, type LocalPrinter } from '@/services/print';
import { useHotelsStore } from '@/stores/hotels';
import type { PaperWidth, Printer, PrinterConnection, PrinterOutput, PrinterPurpose } from '@/types';

const PURPOSES = translated<PrinterPurpose>('printersTab.purposes', ['RECEIPT', 'KITCHEN', 'BAR', 'OTHER']);
const PAPERS = translated<PaperWidth>('printersTab.papers', ['MM58', 'MM80', 'A4']);
const OUTPUTS = translated<PrinterOutput>('printersTab.outputs', ['DIRECT', 'PDF']);
const CONNECTIONS = translated<PrinterConnection>('printersTab.connections', ['LOCAL', 'NETWORK', 'BROWSER']);

const { t } = useI18n();
const hotels = useHotelsStore();
const printers = ref<Printer[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const editingId = ref<number | null>(null);
const local = ref<LocalPrinter[]>([]);
const agentError = ref('');
const agentAddress = ref(agentUrl());

function empty() {
  return {
    name: '',
    purpose: 'RECEIPT' as PrinterPurpose,
    connection: 'LOCAL' as PrinterConnection,
    host: '',
    port: 9100,
    localName: '',
    paperWidth: 'MM80' as PaperWidth,
    output: 'DIRECT' as PrinterOutput,
    copies: 1,
    isDefault: false,
    active: true,
  };
}
const form = reactive(empty());

async function load() {
  printers.value = (await api.get<Printer[]>('/printers', { params: { hotelId: hotels.selectedId } })).data;
}

async function loadLocal() {
  agentError.value = '';
  try {
    local.value = await listLocalPrinters();
  } catch (e) {
    local.value = [];
    agentError.value = errorMessage(e);
  }
}

function saveAgent() {
  setAgentUrl(agentAddress.value.trim());
  agentAddress.value = agentUrl();
  return loadLocal();
}

watch(
  () => form.connection,
  (connection) => {
    if (connection === 'LOCAL' && !local.value.length) loadLocal();
  },
);

async function run(fn: () => Promise<unknown>, message = '') {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await fn();
    notice.value = typeof result === 'string' ? result : message;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function edit(printer: Printer) {
  editingId.value = printer.id;
  Object.assign(form, { ...printer, host: printer.host ?? '', localName: printer.localName ?? '' });
}

function reset() {
  editingId.value = null;
  Object.assign(form, empty());
}

function chooseLocal(name: string) {
  form.localName = printerBaseName(name);
  if (!form.name) form.name = form.localName.slice(0, 60);
}

const isInstalled = (name: string) => local.value.some((item) => printerBaseName(item.name).toLowerCase() === printerBaseName(name).toLowerCase());

const save = () =>
  run(async () => {
    const body = {
      name: form.name,
      purpose: form.purpose,
      connection: form.connection,
      host: form.connection === 'NETWORK' ? form.host.trim() : null,
      port: form.port,
      localName: form.connection === 'LOCAL' ? form.localName : null,
      paperWidth: form.paperWidth,
      output: form.output,
      copies: form.copies,
      isDefault: form.isDefault,
      active: form.active,
    };
    if (editingId.value) await api.patch(`/printers/${editingId.value}`, body);
    else await api.post('/printers', { ...body, hotelId: hotels.selectedId });
    reset();
  }, t('printersTab.saved'));

const test = (printer: Printer) => run(() => printDocument({ document: 'TEST', printerId: printer.id }));
const preview = (printer: Printer) =>
  run(() =>
    previewPdfFrom('/print/pdf', { document: 'TEST', printerId: printer.id, paper: printer.paperWidth }, `${t('printersTab.testPage')} · ${printer.name}`, printer.paperWidth),
  );

function connectionLabel(printer: Printer) {
  if (printer.connection === 'NETWORK') return `${printer.host}:${printer.port}`;
  if (printer.connection === 'LOCAL') return printer.localName ?? '-';
  return t('printersTab.browser');
}

onMounted(() => {
  run(load);
  loadLocal();
});
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-1 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
      <p><strong>{{ CONNECTIONS.LOCAL }}:</strong> {{ t('printersTab.helpLocal') }}</p>
      <p><strong>{{ CONNECTIONS.NETWORK }}:</strong> {{ t('printersTab.helpNetwork') }}</p>
      <p><strong>{{ t('printersTab.browser') }}:</strong> {{ t('printersTab.helpBrowser') }}</p>
      <p><strong>{{ t('printersTab.output') }}:</strong> {{ t('printersTab.helpOutput') }}</p>
      <p>{{ t('printersTab.helpCategories') }}</p>
    </div>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <form class="card grid gap-3 sm:grid-cols-3" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-3">{{ editingId ? t('printersTab.edit') : t('printersTab.new') }}</h2>
      <label class="text-sm">
        {{ t('printersTab.connection') }}
        <select v-model="form.connection" class="input">
          <option v-for="(label, value) in CONNECTIONS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label v-if="form.connection === 'LOCAL'" class="text-sm sm:col-span-2">
        {{ t('printersTab.windowsPrinter') }}
        <div class="flex gap-2">
          <select :value="form.localName" class="input" required @change="chooseLocal(($event.target as HTMLSelectElement).value)">
            <option value="" disabled>{{ local.length ? t('printersTab.choose') : t('printersTab.noneFound') }}</option>
            <option v-if="form.localName && !isInstalled(form.localName)" :value="form.localName">
              {{ form.localName }} ({{ t('printersTab.notHere') }})
            </option>
            <option v-for="item in local" :key="item.name" :value="printerBaseName(item.name)">
              {{ item.name }}{{ item.isDefault ? ` · ${t('printersTab.systemDefault')}` : '' }}{{ item.offline ? ' · offline' : '' }} ({{ item.driver }})
            </option>
          </select>
          <button class="btn-secondary" type="button" :disabled="busy" @click="loadLocal">{{ t('common.update') }}</button>
        </div>
      </label>
      <template v-if="form.connection === 'NETWORK'">
        <label class="text-sm">{{ t('printersTab.ip') }}<input v-model="form.host" class="input" placeholder="192.168.1.50" required /></label>
        <label class="text-sm">{{ t('printersTab.port') }}<input v-model.number="form.port" class="input" type="number" min="1" max="65535" /></label>
      </template>
      <label class="text-sm">{{ t('printersTab.name') }}<input v-model="form.name" class="input" maxlength="60" :placeholder="t('printersTab.nameExample')" required /></label>
      <label class="text-sm">
        {{ t('printersTab.purpose') }}
        <select v-model="form.purpose" class="input">
          <option v-for="(label, purpose) in PURPOSES" :key="purpose" :value="purpose">{{ label }}</option>
        </select>
      </label>
      <label class="text-sm">
        {{ t('printersTab.paper') }}
        <select v-model="form.paperWidth" class="input">
          <option v-for="(label, paper) in PAPERS" :key="paper" :value="paper">{{ label }}</option>
        </select>
      </label>
      <label class="text-sm">
        {{ t('printersTab.output') }}
        <select v-model="form.output" class="input">
          <option v-for="(label, value) in OUTPUTS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label class="text-sm">{{ t('printersTab.copies') }}<input v-model.number="form.copies" class="input" type="number" min="1" max="5" /></label>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.isDefault" type="checkbox" />{{ t('printersTab.isDefault') }}</label>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.active" type="checkbox" />{{ t('settings.activeF') }}</label>
      <p v-if="form.connection === 'LOCAL' && agentError" class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-3">
        {{ agentError }}. {{ t('printersTab.startAgent') }}
      </p>
      <div class="flex justify-end gap-2 sm:col-span-3">
        <button v-if="editingId" class="btn-secondary" type="button" @click="reset">{{ t('common.cancel') }}</button>
        <button class="btn" type="submit" :disabled="busy">{{ t('common.save') }}</button>
      </div>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr><th class="px-4 py-3">{{ t('common.name') }}</th><th class="px-4 py-3">{{ t('printersTab.purpose') }}</th><th class="px-4 py-3">{{ t('printersTab.connection') }}</th><th class="px-4 py-3">{{ t('printersTab.paper') }}</th><th class="px-4 py-3">{{ t('printersTab.copies') }}</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="printer in printers" :key="printer.id" class="border-b border-slate-100" :class="printer.active ? '' : 'text-slate-400'">
            <td class="px-4 py-3 font-medium">
              {{ printer.name }}
              <span v-if="printer.isDefault" class="ml-1 rounded bg-indigo-100 px-1 text-xs text-indigo-800">{{ t('printersTab.main') }}</span>
            </td>
            <td class="px-4 py-3">{{ PURPOSES[printer.purpose] }}</td>
            <td class="px-4 py-3">
              <span class="block text-xs text-slate-500">{{ CONNECTIONS[printer.connection] }}</span>
              {{ connectionLabel(printer) }}
            </td>
            <td class="px-4 py-3">
              {{ PAPERS[printer.paperWidth] }}
              <span v-if="printer.output === 'PDF'" class="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">PDF</span>
            </td>
            <td class="px-4 py-3">{{ printer.copies }}</td>
            <td class="space-x-3 px-4 py-3 text-right text-xs whitespace-nowrap">
              <button class="text-indigo-600 hover:underline" type="button" :disabled="busy || !printer.active" @click="test(printer)">{{ t('printersTab.test') }}</button>
              <button class="text-indigo-600 hover:underline" type="button" :disabled="busy" @click="preview(printer)">{{ t('printersTab.viewPdf') }}</button>
              <button class="text-indigo-600 hover:underline" type="button" @click="edit(printer)">{{ t('common.edit') }}</button>
            </td>
          </tr>
          <tr v-if="!printers.length">
            <td colspan="6" class="px-4 py-4 text-center text-slate-500">{{ t('printersTab.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <details class="card text-sm">
      <summary class="cursor-pointer font-medium">{{ t('printersTab.agent') }}</summary>
      <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="saveAgent">
        <label class="text-sm">
          {{ t('printersTab.agentAddress') }}
          <input v-model="agentAddress" class="input w-72 font-mono" :placeholder="DEFAULT_AGENT_URL" />
        </label>
        <button class="btn-secondary" type="submit">{{ t('printersTab.saveTest') }}</button>
        <span v-if="!agentError" class="text-emerald-700">{{ t('printersTab.connected', { n: local.length }) }}</span>
        <span v-else class="text-amber-700">{{ agentError }}</span>
      </form>
    </details>
  </div>
</template>

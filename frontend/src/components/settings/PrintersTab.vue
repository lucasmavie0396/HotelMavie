<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api, errorMessage } from '@/services/api';
import { agentUrl, DEFAULT_AGENT_URL, listLocalPrinters, previewPdfFrom, printDocument, setAgentUrl, type LocalPrinter } from '@/services/print';
import { useHotelsStore } from '@/stores/hotels';
import type { PaperWidth, Printer, PrinterConnection, PrinterOutput, PrinterPurpose } from '@/types';

const PURPOSES: Record<PrinterPurpose, string> = {
  RECEIPT: 'Pagamentos, faturas e contas',
  KITCHEN: 'Cozinha',
  BAR: 'Bar',
  OTHER: 'Outra (ex.: pastelaria, copa)',
};
const PAPERS: Record<PaperWidth, string> = { MM58: 'Talao 58 mm', MM80: 'Talao 80 mm', A4: 'Folha A4' };
const OUTPUTS: Record<PrinterOutput, string> = { DIRECT: 'Imprimir direto', PDF: 'Mostrar PDF' };
const CONNECTIONS: Record<PrinterConnection, string> = {
  LOCAL: 'Instalada neste computador',
  NETWORK: 'Rede ESC/POS (IP)',
  BROWSER: 'Navegador (janela de impressao)',
};

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
  form.localName = name;
  if (!form.name) form.name = name.slice(0, 60);
}

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
  }, 'Impressora guardada');

const test = (printer: Printer) => run(() => printDocument({ document: 'TEST', printerId: printer.id }));
const preview = (printer: Printer) =>
  run(() =>
    previewPdfFrom('/print/pdf', { document: 'TEST', printerId: printer.id, paper: printer.paperWidth }, `Pagina de teste · ${printer.name}`, printer.paperWidth),
  );

function connectionLabel(printer: Printer) {
  if (printer.connection === 'NETWORK') return `${printer.host}:${printer.port}`;
  if (printer.connection === 'LOCAL') return printer.localName ?? '-';
  return 'Navegador';
}

onMounted(() => {
  run(load);
  loadLocal();
});
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-1 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
      <p>
        <strong>Instalada neste computador:</strong> escolhe uma impressora do Windows (USB, rede ou partilhada). Os taloes saem
        diretamente, sem janela de impressao, atraves do agente de impressao (<code>print-agent/iniciar.cmd</code>) que tem de
        estar a correr no computador onde se emite o documento. Em folha A4 abre a janela de impressao.
      </p>
      <p><strong>Rede (ESC/POS):</strong> o servidor envia diretamente para impressoras termicas com IP (porta 9100).</p>
      <p><strong>Navegador:</strong> abre sempre a janela de impressao do computador.</p>
      <p>
        <strong>Saida:</strong> em <em>Imprimir direto</em> o documento sai na impressora; em <em>Mostrar PDF</em> abre no ecra com o
        tamanho do papel (80 mm, 58 mm ou A4) para analisar o design, e pode ser impresso ou descarregado a partir dai.
      </p>
      <p>Cada categoria de produtos pode ter a sua impressora (em Produtos); sem isso, usa a impressora principal da cozinha ou do bar.</p>
    </div>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <form class="card grid gap-3 sm:grid-cols-3" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-3">{{ editingId ? 'Editar impressora' : 'Nova impressora' }}</h2>
      <label class="text-sm">
        Ligacao
        <select v-model="form.connection" class="input">
          <option v-for="(label, value) in CONNECTIONS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label v-if="form.connection === 'LOCAL'" class="text-sm sm:col-span-2">
        Impressora do Windows
        <div class="flex gap-2">
          <select :value="form.localName" class="input" required @change="chooseLocal(($event.target as HTMLSelectElement).value)">
            <option value="" disabled>{{ local.length ? 'Escolhe a impressora' : 'Sem impressoras (agente parado?)' }}</option>
            <option v-if="form.localName && !local.some((item) => item.name === form.localName)" :value="form.localName">
              {{ form.localName }} (nao encontrada neste computador)
            </option>
            <option v-for="item in local" :key="item.name" :value="item.name">
              {{ item.name }}{{ item.isDefault ? ' · predefinida' : '' }}{{ item.offline ? ' · offline' : '' }} ({{ item.driver }})
            </option>
          </select>
          <button class="btn-secondary" type="button" :disabled="busy" @click="loadLocal">Atualizar</button>
        </div>
      </label>
      <template v-if="form.connection === 'NETWORK'">
        <label class="text-sm">Endereco IP<input v-model="form.host" class="input" placeholder="192.168.1.50" required /></label>
        <label class="text-sm">Porta<input v-model.number="form.port" class="input" type="number" min="1" max="65535" /></label>
      </template>
      <label class="text-sm">Nome no sistema<input v-model="form.name" class="input" maxlength="60" placeholder="Ex.: Cozinha quente" required /></label>
      <label class="text-sm">
        Finalidade
        <select v-model="form.purpose" class="input">
          <option v-for="(label, purpose) in PURPOSES" :key="purpose" :value="purpose">{{ label }}</option>
        </select>
      </label>
      <label class="text-sm">
        Papel
        <select v-model="form.paperWidth" class="input">
          <option v-for="(label, paper) in PAPERS" :key="paper" :value="paper">{{ label }}</option>
        </select>
      </label>
      <label class="text-sm">
        Saida
        <select v-model="form.output" class="input">
          <option v-for="(label, value) in OUTPUTS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label class="text-sm">Copias<input v-model.number="form.copies" class="input" type="number" min="1" max="5" /></label>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.isDefault" type="checkbox" />Principal para esta finalidade</label>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.active" type="checkbox" />Ativa</label>
      <p v-if="form.connection === 'LOCAL' && agentError" class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-3">
        {{ agentError }}. Arranca o agente neste computador e carrega em Atualizar.
      </p>
      <div class="flex justify-end gap-2 sm:col-span-3">
        <button v-if="editingId" class="btn-secondary" type="button" @click="reset">Cancelar</button>
        <button class="btn" type="submit" :disabled="busy">Guardar</button>
      </div>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr><th class="px-4 py-3">Nome</th><th class="px-4 py-3">Finalidade</th><th class="px-4 py-3">Ligacao</th><th class="px-4 py-3">Papel</th><th class="px-4 py-3">Copias</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="printer in printers" :key="printer.id" class="border-b border-slate-100" :class="printer.active ? '' : 'text-slate-400'">
            <td class="px-4 py-3 font-medium">
              {{ printer.name }}
              <span v-if="printer.isDefault" class="ml-1 rounded bg-indigo-100 px-1 text-xs text-indigo-800">principal</span>
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
              <button class="text-indigo-600 hover:underline" type="button" :disabled="busy || !printer.active" @click="test(printer)">Testar</button>
              <button class="text-indigo-600 hover:underline" type="button" :disabled="busy" @click="preview(printer)">Ver PDF</button>
              <button class="text-indigo-600 hover:underline" type="button" @click="edit(printer)">Editar</button>
            </td>
          </tr>
          <tr v-if="!printers.length">
            <td colspan="6" class="px-4 py-4 text-center text-slate-500">Sem impressoras: os documentos abrem na janela de impressao do navegador em 80 mm.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <details class="card text-sm">
      <summary class="cursor-pointer font-medium">Agente de impressao deste computador</summary>
      <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="saveAgent">
        <label class="text-sm">
          Endereco do agente
          <input v-model="agentAddress" class="input w-72 font-mono" :placeholder="DEFAULT_AGENT_URL" />
        </label>
        <button class="btn-secondary" type="submit">Guardar e testar</button>
        <span v-if="!agentError" class="text-emerald-700">Ligado · {{ local.length }} impressoras encontradas</span>
        <span v-else class="text-amber-700">{{ agentError }}</span>
      </form>
    </details>
  </div>
</template>

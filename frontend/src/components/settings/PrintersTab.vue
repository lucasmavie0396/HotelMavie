<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { printDocument } from '@/services/print';
import { useHotelsStore } from '@/stores/hotels';
import type { PaperWidth, Printer, PrinterPurpose } from '@/types';

const PURPOSES: Record<PrinterPurpose, string> = {
  RECEIPT: 'Pagamentos, faturas e contas',
  KITCHEN: 'Cozinha',
  BAR: 'Bar',
  OTHER: 'Outra (ex.: pastelaria, copa)',
};
const PAPERS: Record<PaperWidth, string> = { MM58: 'Talao 58 mm', MM80: 'Talao 80 mm', A4: 'Folha A4' };

const hotels = useHotelsStore();
const printers = ref<Printer[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const editingId = ref<number | null>(null);

function empty() {
  return { name: '', purpose: 'RECEIPT' as PrinterPurpose, connection: 'BROWSER' as 'BROWSER' | 'NETWORK', host: '', port: 9100, paperWidth: 'MM80' as PaperWidth, copies: 1, isDefault: false, active: true };
}
const form = reactive(empty());

async function load() {
  printers.value = (await api.get<Printer[]>('/printers', { params: { hotelId: hotels.selectedId } })).data;
}

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
  Object.assign(form, { ...printer, host: printer.host ?? '' });
}

function reset() {
  editingId.value = null;
  Object.assign(form, empty());
}

const save = () =>
  run(async () => {
    const { ...payload } = form;
    const body = {
      name: payload.name,
      purpose: payload.purpose,
      connection: payload.connection,
      host: payload.connection === 'NETWORK' ? payload.host.trim() : null,
      port: payload.port,
      paperWidth: payload.paperWidth,
      copies: payload.copies,
      isDefault: payload.isDefault,
      active: payload.active,
    };
    if (editingId.value) await api.patch(`/printers/${editingId.value}`, body);
    else await api.post('/printers', { ...body, hotelId: hotels.selectedId });
    reset();
  }, 'Impressora guardada');

const test = (printer: Printer) => run(() => printDocument({ document: 'TEST', printerId: printer.id }));

onMounted(() => run(load));
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
      <p><strong>Navegador:</strong> abre a janela de impressao do computador (qualquer impressora instalada, incluindo termicas USB).</p>
      <p><strong>Rede (ESC/POS):</strong> o servidor envia diretamente para impressoras termicas com IP (porta 9100), sem janela de impressao. Ideal para cozinha e bar.</p>
      <p>Cada categoria de produtos pode ter a sua impressora (em Produtos); sem isso, usa a impressora principal da cozinha ou do bar.</p>
    </div>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <form class="card grid gap-3 sm:grid-cols-3" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-3">{{ editingId ? 'Editar impressora' : 'Nova impressora' }}</h2>
      <label class="text-sm">Nome<input v-model="form.name" class="input" placeholder="Ex.: Cozinha quente" required /></label>
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
        Ligacao
        <select v-model="form.connection" class="input">
          <option value="BROWSER">Navegador (janela de impressao)</option>
          <option value="NETWORK">Rede ESC/POS (IP)</option>
        </select>
      </label>
      <template v-if="form.connection === 'NETWORK'">
        <label class="text-sm">Endereco IP<input v-model="form.host" class="input" placeholder="192.168.1.50" required /></label>
        <label class="text-sm">Porta<input v-model.number="form.port" class="input" type="number" min="1" max="65535" /></label>
      </template>
      <label class="text-sm">Copias<input v-model.number="form.copies" class="input" type="number" min="1" max="5" /></label>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.isDefault" type="checkbox" />Principal para esta finalidade</label>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.active" type="checkbox" />Ativa</label>
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
            <td class="px-4 py-3">{{ printer.connection === 'NETWORK' ? `${printer.host}:${printer.port}` : 'Navegador' }}</td>
            <td class="px-4 py-3">{{ PAPERS[printer.paperWidth] }}</td>
            <td class="px-4 py-3">{{ printer.copies }}</td>
            <td class="space-x-3 px-4 py-3 text-right text-xs whitespace-nowrap">
              <button class="text-indigo-600 hover:underline" type="button" :disabled="busy || !printer.active" @click="test(printer)">Testar</button>
              <button class="text-indigo-600 hover:underline" type="button" @click="edit(printer)">Editar</button>
            </td>
          </tr>
          <tr v-if="!printers.length">
            <td colspan="6" class="px-4 py-4 text-center text-slate-500">Sem impressoras: os documentos abrem na janela de impressao do navegador em 80 mm.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

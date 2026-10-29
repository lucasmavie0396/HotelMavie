<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api, errorMessage } from '@/services/api';
import { fileUrl, readImage } from '@/services/files';
import { useHotelsStore } from '@/stores/hotels';

const hotels = useHotelsStore();
const error = ref('');
const notice = ref('');
const busy = ref(false);
const form = reactive({ publicDescription: '', depositPercent: 60, paymentInstructions: '' });
const hotel = computed(() => hotels.selected);
const publicLink = computed(() => (hotel.value?.publicSlug ? `${window.location.origin}/h/${hotel.value.publicSlug}` : ''));

watch(
  hotel,
  (value) => {
    Object.assign(form, {
      publicDescription: value?.publicDescription ?? '',
      depositPercent: Number(value?.depositPercent ?? 60),
      paymentInstructions: value?.paymentInstructions ?? '',
    });
  },
  { immediate: true },
);

async function run(fn: () => Promise<unknown>, message: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
    await hotels.load(true);
    notice.value = message;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const save = () =>
  run(
    () =>
      api.patch(`/hotels/${hotels.selectedId}`, {
        publicDescription: form.publicDescription || null,
        depositPercent: Number(form.depositPercent),
        paymentInstructions: form.paymentInstructions || null,
      }),
    'Dados do site guardados',
  );

async function uploadLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  await run(async () => api.post(`/hotels/${hotels.selectedId}/logo`, { data: await readImage(file, ['image/png', 'image/jpeg']) }), 'Logotipo atualizado');
}

const removeLogo = () => run(() => api.delete(`/hotels/${hotels.selectedId}/logo`), 'Logotipo removido');
</script>

<template>
  <div class="space-y-4">
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <div class="card flex flex-wrap items-center gap-6">
      <div class="flex h-24 w-48 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50">
        <img v-if="hotel?.logoFile" :src="fileUrl(hotel.logoFile)" alt="Logotipo do hotel" class="max-h-20 max-w-44 object-contain" />
        <span v-else class="text-xs text-slate-400">Sem logotipo</span>
      </div>
      <div class="space-y-2 text-sm">
        <h2 class="font-semibold">Logotipo</h2>
        <p class="text-slate-600">PNG ou JPG ate 4 MB. Aparece no site publico e no comprovativo de sinal em A4.</p>
        <div class="flex gap-2">
          <label class="btn cursor-pointer" :class="busy ? 'pointer-events-none opacity-60' : ''">
            {{ hotel?.logoFile ? 'Substituir' : 'Carregar logotipo' }}
            <input class="hidden" type="file" accept="image/png,image/jpeg" @change="uploadLogo" />
          </label>
          <button v-if="hotel?.logoFile" class="btn-secondary" type="button" :disabled="busy" @click="removeLogo">Remover</button>
        </div>
      </div>
    </div>

    <form class="card grid gap-3 sm:grid-cols-2" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-2">Site publico e reservas online</h2>
      <p class="text-sm text-slate-600 sm:col-span-2">
        <template v-if="publicLink && hotel?.publicEnabled">
          Endereco do site: <a :href="publicLink" target="_blank" class="text-indigo-600 hover:underline">{{ publicLink }}</a>
        </template>
        <template v-else>O site publico esta desligado ou sem endereco: ativa-o em Hoteis.</template>
        As fotografias de cada quarto carregam-se em Quartos.
      </p>
      <label class="text-sm sm:col-span-2">
        Apresentacao do hotel
        <textarea v-model="form.publicDescription" class="input" rows="4" maxlength="5000" placeholder="Localizacao, servicos, horario de check-in e check-out..." />
      </label>
      <label class="text-sm">
        Sinal pedido nas reservas online (%)
        <input v-model.number="form.depositPercent" class="input" type="number" min="0" max="100" step="0.01" required />
        <span class="text-xs text-slate-500">0 = sem sinal. O restante cobra-se no check-in ou no check-out.</span>
      </label>
      <label class="text-sm sm:col-span-2">
        Instrucoes de pagamento do sinal
        <textarea
          v-model="form.paymentInstructions"
          class="input"
          rows="4"
          maxlength="2000"
          placeholder="Ex.: Transferencia para o NIB 0000 0000 0000 0000 0000 0 (Banco X)&#10;M-Pesa: 84 000 0000 (Hotel Mavie)&#10;Indique o codigo da transacao no pedido de reserva."
        />
      </label>
      <div class="flex justify-end sm:col-span-2">
        <button class="btn" type="submit" :disabled="busy">Guardar</button>
      </div>
    </form>
  </div>
</template>

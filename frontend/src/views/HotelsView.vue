<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Hotel } from '@/types';

const hotels = useHotelsStore();
const error = ref('');
const saving = ref(false);
const editingId = ref<number | null>(null);

function emptyForm() {
  return { name: '', publicSlug: '', publicEnabled: false, currency: 'EUR', email: '', phone: '', address: '' };
}

const form = reactive(emptyForm());

function edit(hotel: Hotel) {
  editingId.value = hotel.id;
  Object.assign(form, {
    name: hotel.name,
    publicSlug: hotel.publicSlug ?? '',
    publicEnabled: hotel.publicEnabled,
    currency: hotel.currency,
    email: hotel.email ?? '',
    phone: hotel.phone ?? '',
    address: hotel.address ?? '',
  });
}

function reset() {
  editingId.value = null;
  Object.assign(form, emptyForm());
}

async function save() {
  saving.value = true;
  error.value = '';
  const payload = {
    ...form,
    currency: form.currency.toUpperCase(),
    publicSlug: form.publicSlug || undefined,
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
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="hotels" subtitle="Hoteis geridos e site publico de cada um" />

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <form class="card grid gap-3 sm:grid-cols-4" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-4">{{ editingId ? 'Editar hotel' : 'Novo hotel' }}</h2>
      <input v-model="form.name" class="input sm:col-span-2" placeholder="Nome do hotel" required />
      <input v-model="form.publicSlug" class="input" placeholder="slug-publico" />
      <input v-model="form.currency" class="input" placeholder="Moeda (EUR, AOA, MZN...)" maxlength="3" required />
      <input v-model="form.email" class="input" type="email" placeholder="Email" />
      <input v-model="form.phone" class="input" placeholder="Telefone" />
      <input v-model="form.address" class="input sm:col-span-2" placeholder="Morada" />
      <label class="flex items-center gap-2 text-sm">
        <input v-model="form.publicEnabled" type="checkbox" />
        Site publico ativo
      </label>
      <div class="flex justify-end gap-2 sm:col-span-3">
        <button v-if="editingId" class="btn-secondary" type="button" @click="reset">Cancelar</button>
        <button class="btn" type="submit" :disabled="saving">{{ editingId ? 'Guardar' : 'Adicionar hotel' }}</button>
      </div>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">Nome</th>
            <th class="px-4 py-3">Moeda</th>
            <th class="px-4 py-3">Site publico</th>
            <th class="px-4 py-3">Contacto</th>
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
              <span v-else class="text-slate-400">Inativo</span>
            </td>
            <td class="px-4 py-3">{{ hotel.email ?? hotel.phone ?? '-' }}</td>
            <td class="px-4 py-3 text-right">
              <button class="text-xs text-indigo-600 hover:underline" type="button" @click="edit(hotel)">Editar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

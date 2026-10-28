<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { UserRole } from '@/types';
import { formatDateTime } from '@/utils/format';

interface StaffUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  hotelId: number | null;
  createdAt: string;
}

interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

const ROLE_LABELS: Record<UserRole, string> = { ADMIN: 'Administrador', MANAGER: 'Gestor', RECEPTION: 'Rececao' };

const hotels = useHotelsStore();
const users = ref<StaffUser[]>([]);
const backups = ref<BackupFile[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const editingId = ref<number | null>(null);

function emptyForm() {
  return { name: '', email: '', password: '', role: 'RECEPTION' as UserRole, hotelId: hotels.selectedId ?? 0, active: true };
}

const form = reactive(emptyForm());

async function load() {
  try {
    const [u, b] = await Promise.all([api.get<StaffUser[]>('/users'), api.get<BackupFile[]>('/backups')]);
    users.value = u.data;
    backups.value = b.data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(fn: () => Promise<unknown>, message = '') {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
    notice.value = message;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function edit(user: StaffUser) {
  editingId.value = user.id;
  Object.assign(form, { name: user.name, email: user.email, password: '', role: user.role, hotelId: user.hotelId ?? 0, active: user.active });
}

function reset() {
  editingId.value = null;
  Object.assign(form, emptyForm());
}

const save = () =>
  run(async () => {
    const payload = {
      name: form.name,
      email: form.email,
      role: form.role,
      active: form.active,
      hotelId: form.role === 'ADMIN' ? undefined : form.hotelId || undefined,
      ...(form.password ? { password: form.password } : {}),
    };
    if (editingId.value) {
      await api.patch(`/users/${editingId.value}`, payload);
    } else {
      await api.post('/users', payload);
    }
    reset();
  }, 'Utilizador guardado');

const createBackup = () => run(() => api.post('/backups'), 'Backup criado');

async function download(name: string) {
  try {
    const { data } = await api.get<Blob>(`/backups/${name}`, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <h1 class="text-2xl font-semibold">Funcionarios e sistema</h1>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <form class="card grid gap-3 sm:grid-cols-3" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-3">{{ editingId ? 'Editar utilizador' : 'Novo utilizador' }}</h2>
      <input v-model="form.name" class="input" placeholder="Nome" required />
      <input v-model="form.email" class="input" type="email" placeholder="Email" required />
      <input
        v-model="form.password"
        class="input"
        type="password"
        autocomplete="new-password"
        :placeholder="editingId ? 'Nova password (opcional)' : 'Password (min. 8)'"
        :required="!editingId"
        minlength="8"
      />
      <select v-model="form.role" class="input">
        <option v-for="(label, role) in ROLE_LABELS" :key="role" :value="role">{{ label }}</option>
      </select>
      <select v-model.number="form.hotelId" class="input" :disabled="form.role === 'ADMIN'">
        <option v-for="hotel in hotels.hotels" :key="hotel.id" :value="hotel.id">{{ hotel.name }}</option>
      </select>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.active" type="checkbox" />Ativo</label>
      <p class="text-xs text-slate-500 sm:col-span-2">
        Gestor: configuracao, compras, devolucoes e notas de credito. Rececao: operacao diaria. Mudar a password ou desativar termina as sessoes abertas.
      </p>
      <div class="flex justify-end gap-2">
        <button v-if="editingId" class="btn-secondary" type="button" @click="reset">Cancelar</button>
        <button class="btn" type="submit" :disabled="busy">Guardar</button>
      </div>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">Nome</th>
            <th class="px-4 py-3">Email</th>
            <th class="px-4 py-3">Papel</th>
            <th class="px-4 py-3">Hotel</th>
            <th class="px-4 py-3">Estado</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id" class="border-b border-slate-100" :class="user.active ? '' : 'text-slate-400'">
            <td class="px-4 py-3 font-medium">{{ user.name }}</td>
            <td class="px-4 py-3">{{ user.email }}</td>
            <td class="px-4 py-3">{{ ROLE_LABELS[user.role] }}</td>
            <td class="px-4 py-3">{{ user.hotelId ? hotels.nameOf(user.hotelId) : 'Todos' }}</td>
            <td class="px-4 py-3">{{ user.active ? 'Ativo' : 'Inativo' }}</td>
            <td class="px-4 py-3 text-right">
              <button class="text-xs text-indigo-600 hover:underline" type="button" @click="edit(user)">Editar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">Backups da base de dados</h2>
        <button class="btn" type="button" :disabled="busy" @click="createBackup">Criar backup agora</button>
      </div>
      <p class="text-xs text-slate-500">
        Os backups ficam na pasta do servidor (BACKUP_DIR). Guarda uma copia fora do servidor regularmente.
      </p>
      <ul class="divide-y divide-slate-100 text-sm">
        <li v-for="file in backups" :key="file.name" class="flex items-center justify-between py-2">
          <span>{{ file.name }} <span class="text-slate-500">· {{ formatDateTime(file.createdAt) }} · {{ (file.size / 1024).toFixed(0) }} KB</span></span>
          <button class="text-xs text-indigo-600 hover:underline" type="button" @click="download(file.name)">Descarregar</button>
        </li>
        <li v-if="!backups.length" class="py-2 text-slate-500">Ainda nao ha backups</li>
      </ul>
    </div>
  </section>
</template>

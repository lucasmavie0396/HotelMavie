<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NotificationsBell from '@/components/NotificationsBell.vue';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';

const auth = useAuthStore();
const hotels = useHotelsStore();
const route = useRoute();
const router = useRouter();

const links = computed(() => [
  { to: { name: 'dashboard' }, label: 'Painel' },
  { to: { name: 'calendar' }, label: 'Calendario' },
  { to: { name: 'reservations' }, label: 'Reservas' },
  { to: { name: 'guests' }, label: 'Hospedes' },
  { to: { name: 'rooms' }, label: 'Quartos' },
  { to: { name: 'pos' }, label: 'Restaurante / Bar' },
  { to: { name: 'invoices' }, label: 'Faturacao' },
  { to: { name: 'cash' }, label: 'Caixa' },
  { to: { name: 'products' }, label: 'Produtos' },
  { to: { name: 'stock' }, label: 'Stocks' },
  ...(auth.user?.role !== 'RECEPTION' ? [{ to: { name: 'purchases' }, label: 'Compras' }] : []),
  ...(auth.user?.role !== 'RECEPTION' ? [{ to: { name: 'reports' }, label: 'Relatorios' }] : []),
  ...(auth.user?.role !== 'RECEPTION' ? [{ to: { name: 'settings' }, label: 'Configuracao' }] : []),
  ...(auth.user?.role === 'ADMIN' ? [{ to: { name: 'users' }, label: 'Funcionarios' }] : []),
  ...(auth.user?.role === 'ADMIN' ? [{ to: { name: 'hotels' }, label: 'Hoteis' }] : []),
]);

onMounted(() => hotels.load());

async function logout() {
  await auth.logout();
  hotels.reset();
  await router.push({ name: 'login' });
}
</script>

<template>
  <div class="flex min-h-screen flex-col md:flex-row">
    <aside class="bg-slate-900 text-slate-100 md:w-56 md:shrink-0">
      <div class="px-5 py-4 text-lg font-semibold">MAVIE-HGest</div>
      <nav class="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
        <RouterLink
          v-for="link in links"
          :key="link.label"
          :to="link.to"
          class="rounded-md px-3 py-2 text-sm whitespace-nowrap hover:bg-slate-800"
          :active-class="link.to.name === 'dashboard' ? '' : 'bg-slate-800 font-medium'"
          exact-active-class="bg-slate-800 font-medium"
        >
          {{ link.label }}
        </RouterLink>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <select
          v-if="hotels.hotels.length > 1"
          v-model.number="hotels.selectedId"
          class="input w-auto"
          aria-label="Hotel ativo"
        >
          <option v-for="hotel in hotels.hotels" :key="hotel.id" :value="hotel.id">{{ hotel.name }}</option>
        </select>
        <span v-else class="text-sm font-medium">{{ hotels.selected?.name }}</span>
        <div class="flex items-center gap-3">
          <NotificationsBell v-if="hotels.selectedId" :key="hotels.selectedId" />
          <span class="text-sm text-slate-600">{{ auth.user?.name }}</span>
          <button class="btn-secondary" type="button" @click="logout">Sair</button>
        </div>
      </header>
      <main class="flex-1 p-6">
        <RouterView v-if="hotels.selectedId || route.name === 'hotels'" :key="hotels.selectedId ?? 0" />
        <p v-else-if="hotels.loaded" class="text-sm text-slate-500">
          Nao ha nenhum hotel associado a esta conta.
          <RouterLink v-if="auth.user?.role === 'ADMIN'" :to="{ name: 'hotels' }" class="text-indigo-600 hover:underline">
            Criar hotel
          </RouterLink>
        </p>
        <p v-else class="text-sm text-slate-500">A carregar...</p>
      </main>
    </div>
  </div>
</template>

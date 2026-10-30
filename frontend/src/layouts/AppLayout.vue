<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NotificationsBell from '@/components/NotificationsBell.vue';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import { SECTIONS } from '@/utils/sections';

const auth = useAuthStore();
const hotels = useHotelsStore();
const route = useRoute();
const router = useRouter();

const links = computed(() =>
  [
    'dashboard',
    'calendar',
    'reservations',
    'guests',
    'rooms',
    'pos',
    'invoices',
    'accounts',
    'cash',
    'products',
    'stock',
    'hr',
    'reports',
    ...(auth.user?.role !== 'RECEPTION' ? ['purchases', 'settings'] : []),
    ...(auth.user?.role === 'ADMIN' ? ['users', 'hotels'] : []),
  ].map((name) => ({ to: { name }, name, ...SECTIONS[name] })),
);

const content = ref<HTMLElement | null>(null);

watch(
  () => route.fullPath,
  () => content.value?.scrollTo({ top: 0 }),
);

onMounted(() => hotels.load());

async function logout() {
  await auth.logout();
  hotels.reset();
  await router.push({ name: 'login' });
}
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden md:flex-row">
    <aside class="shrink-0 bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950 text-slate-100 md:w-60 md:overflow-y-auto">
      <div class="flex items-center gap-2.5 px-5 py-4">
        <span class="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-bold shadow-lg">M</span>
        <span class="text-lg font-semibold tracking-tight">MAVIE-HGest</span>
      </div>
      <nav class="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col">
        <RouterLink v-for="link in links" :key="link.name" v-slot="{ href, navigate, isActive, isExactActive }" :to="link.to" custom>
          <a
            :href="href"
            class="group flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm whitespace-nowrap transition"
            :class="(link.name === 'dashboard' ? isExactActive : isActive) ? 'bg-white/10 font-medium text-white shadow-inner' : 'text-slate-300 hover:bg-white/5 hover:text-white'"
            :aria-current="(link.name === 'dashboard' ? isExactActive : isActive) ? 'page' : undefined"
            @click="navigate"
          >
            <span
              class="flex size-7 shrink-0 items-center justify-center rounded-lg text-white transition"
              :class="(link.name === 'dashboard' ? isExactActive : isActive) ? `${link.dot} shadow-md` : 'bg-white/5 group-hover:bg-white/10'"
            >
              <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path :d="link.icon" />
              </svg>
            </span>
            {{ link.label }}
          </a>
        </RouterLink>
      </nav>
    </aside>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header class="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
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
      <main ref="content" class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
        <RouterView v-if="hotels.selectedId || route.name === 'hotels'" :key="hotels.selectedId ?? 0" />
        <p v-else-if="hotels.loaded" class="text-sm text-slate-500">
          Nao ha nenhum hotel associado a esta conta.
          <RouterLink v-if="auth.user?.role === 'ADMIN'" :to="{ name: 'hotels' }" class="text-indigo-600 hover:underline">
            Criar hotel
          </RouterLink>
        </p>
        <div v-else-if="hotels.loadError" class="space-y-2 text-sm">
          <p class="text-rose-600">Nao foi possivel ligar ao servidor: {{ hotels.loadError }}</p>
          <button class="btn-secondary" type="button" @click="hotels.load(true)">Tentar novamente</button>
        </div>
        <p v-else class="text-sm text-slate-500">A carregar...</p>
      </main>
    </div>
  </div>
</template>

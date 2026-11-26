<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import NotificationsBell from '@/components/NotificationsBell.vue';
import PdfPreviewDialog from '@/components/PdfPreviewDialog.vue';
import ScreenKeyboard from '@/components/ScreenKeyboard.vue';
import TouchDialog from '@/components/TouchDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { setPageIdentity } from '@/services/favicon';
import { fileUrl } from '@/services/files';
import { useHotelsStore } from '@/stores/hotels';
import { useLicenseStore } from '@/stores/license';
import { allowedRoutes } from '@/utils/access';
import { SECTIONS } from '@/utils/sections';
import { KEYBOARD_MODES, SCALES, readKeyboardMode, readMenuCollapsed, readScreen, saveKeyboardMode, saveMenuCollapsed, saveScreen, type KeyboardMode } from '@/utils/screen';

const { t } = useI18n();
const auth = useAuthStore();
const hotels = useHotelsStore();
const route = useRoute();
const router = useRouter();

const links = computed(() =>
  (auth.user?.permissions ? [...(auth.isCashier ? [] : ['dashboard']), ...allowedRoutes(auth.user.permissions)] : auth.isCashier ? ['pos', 'cash', 'cards'] : [
    'dashboard',
    'calendar',
    'reservations',
    'guests',
    'rooms',
    'pos',
    'kitchen',
    'invoices',
    'accounts',
    'cash',
    'cards',
    'expenses',
    'products',
    'stock',
    'hr',
    'reports',
    ...(auth.isManager ? ['purchases', 'audit', 'settings'] : []),
    ...(auth.user?.role === 'ADMIN' ? ['users', 'permissions', 'hotels'] : []),
  ]).map((name) => ({ to: { name }, name, ...SECTIONS[name] })),
);

const content = ref<HTMLElement | null>(null);
const collapsed = ref(readMenuCollapsed());
const screenOpen = ref(false);
const screen = ref(readScreen());
const keyboardMode = ref<KeyboardMode>(readKeyboardMode());

function toggleMenu() {
  collapsed.value = !collapsed.value;
  saveMenuCollapsed(collapsed.value);
}

watch(screen, (value) => saveScreen(value), { deep: true });
watch(keyboardMode, (value) => saveKeyboardMode(value));

watch(
  () => route.fullPath,
  () => content.value?.scrollTo({ top: 0 }),
);

watch(
  () => [hotels.selected?.name, hotels.selected?.logoFile],
  () => {
    const hotel = hotels.selected;
    setPageIdentity(hotel ? `${hotel.name} · MAVIE-HGest` : 'MAVIE-HGest', hotel?.logoFile ? fileUrl(hotel.logoFile) : null);
  },
  { immediate: true },
);

const license = useLicenseStore();
watch(
  () => hotels.selectedId,
  () => license.load(true),
);
setInterval(() => license.load(true), 5 * 60_000);

onMounted(() => {
  license.load(true);
  hotels.load();
  auth.refreshPermissions();
});

async function logout() {
  await auth.logout();
  hotels.reset();
  await router.push({ name: 'login' });
}
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden md:flex-row">
    <aside class="shrink-0 bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950 text-slate-100 md:overflow-y-auto" :class="collapsed ? 'md:w-16' : 'md:w-60'">
      <div class="flex items-center gap-2.5 px-5 py-4" :class="collapsed ? 'md:justify-center md:px-0' : ''">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-bold shadow-lg">M</span>
        <span class="text-lg font-semibold tracking-tight" :class="collapsed ? 'md:hidden' : ''">MAVIE-HGest</span>
      </div>
      <nav class="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col" :class="collapsed ? 'md:px-2' : ''">
        <RouterLink v-for="link in links" :key="link.name" v-slot="{ href, navigate, isActive, isExactActive }" :to="link.to" custom>
          <a
            :href="href"
            class="group flex min-h-11 items-center gap-3 rounded-xl px-2.5 py-2 text-sm whitespace-nowrap transition"
            :title="collapsed ? link.label : undefined"
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
            <span :class="collapsed ? 'md:sr-only' : ''">{{ link.label }}</span>
          </a>
        </RouterLink>
      </nav>
    </aside>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header class="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 xl:px-6">
        <div class="flex min-w-0 items-center gap-2">
        <button class="btn-icon hidden md:inline-flex" type="button" :aria-label="collapsed ? t('layout.expandMenu') : t('layout.collapseMenu')" :title="collapsed ? t('layout.expandMenu') : t('layout.collapseMenu')" :aria-pressed="collapsed" @click="toggleMenu">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 5h18v14H3zM9 5v14" />
            <path :d="collapsed ? 'M13 10l2 2-2 2' : 'M16 10l-2 2 2 2'" />
          </svg>
        </button>
        <select
          v-if="hotels.hotels.length > 1"
          v-model.number="hotels.selectedId"
          class="input w-auto"
          :aria-label="t('layout.activeHotel')"
        >
          <option v-for="hotel in hotels.hotels" :key="hotel.id" :value="hotel.id">{{ hotel.name }}</option>
        </select>
        <span v-else class="truncate text-sm font-medium">{{ hotels.selected?.name }}</span>
        </div>
        <div class="flex items-center gap-2 xl:gap-3">
          <div class="relative">
            <button class="btn-secondary gap-1.5 px-3" type="button" :aria-expanded="screenOpen" @click="screenOpen = !screenOpen">
              <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 4h18v12H3zM8 20h8M12 16v4" />
              </svg>
              {{ t('screen.button') }}
            </button>
            <div v-if="screenOpen" class="absolute right-0 z-50 mt-2 w-72 space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-xl" role="dialog" :aria-label="t('screen.title')">
              <p class="font-semibold text-slate-800">{{ t('screen.title') }}</p>
              <label class="flex cursor-pointer items-start gap-3">
                <input v-model="screen.touch" type="checkbox" class="mt-0.5 size-5" />
                <span>
                  <span class="block font-medium">{{ t('screen.touch') }}</span>
                  <span class="text-xs text-slate-500">{{ t('screen.touchHint') }}</span>
                </span>
              </label>
              <label class="block">
                <span class="mb-1 block text-xs font-medium text-slate-600">{{ t('screen.scale') }}</span>
                <select v-model.number="screen.scale" class="input">
                  <option v-for="value in SCALES" :key="value" :value="value">{{ t('screen.scaleOption', { n: value }) }}</option>
                </select>
              </label>
              <label class="block">
                <span class="mb-1 block text-xs font-medium text-slate-600">{{ t('screen.keyboardMode') }}</span>
                <select v-model="keyboardMode" class="input">
                  <option v-for="value in KEYBOARD_MODES" :key="value" :value="value">{{ t(`screen.modes.${value}`) }}</option>
                </select>
              </label>
              <p class="text-xs text-slate-500">{{ t('screen.saved') }}</p>
              <button class="btn-secondary w-full" type="button" @click="screenOpen = false">OK</button>
            </div>
          </div>
          <NotificationsBell v-if="hotels.selectedId && !auth.isCashier" :key="hotels.selectedId" />
          <LanguageSwitcher />
          <RouterLink :to="{ name: 'account' }" class="text-sm text-slate-600 hover:text-indigo-600 hover:underline" :title="t('layout.accountTitle')">{{ auth.user?.name }}</RouterLink>
          <button class="btn-secondary" type="button" @click="logout">{{ t('layout.logout') }}</button>
        </div>
      </header>
      <main ref="content" class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 xl:p-6">
        <RouterLink
          v-if="license.status && license.status.state !== 'VALID'"
          :to="{ name: 'settings', query: { tab: 'system' } }"
          role="alert"
          class="mb-3 block rounded-lg px-3 py-2 text-sm font-medium"
          :class="license.status.blocked ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-900'"
          data-testid="license-banner"
        >
          {{ license.status.message }}
        </RouterLink>
        <RouterView v-if="hotels.selectedId || route.name === 'hotels'" :key="hotels.selectedId ?? 0" />
        <p v-else-if="hotels.loaded" class="text-sm text-slate-500">
          {{ t('layout.noHotel') }}
          <RouterLink v-if="auth.user?.role === 'ADMIN'" :to="{ name: 'hotels' }" class="text-indigo-600 hover:underline">
            {{ t('layout.createHotel') }}
          </RouterLink>
        </p>
        <div v-else-if="hotels.loadError" class="space-y-2 text-sm">
          <p class="text-rose-600">{{ t('layout.serverError', { error: hotels.loadError }) }}</p>
          <button class="btn-secondary" type="button" @click="hotels.load(true)">{{ t('layout.retry') }}</button>
        </div>
        <p v-else class="text-sm text-slate-500">{{ t('common.loading') }}</p>
      </main>
    </div>
    <PdfPreviewDialog />
    <TouchDialog />
    <ScreenKeyboard />
  </div>
</template>

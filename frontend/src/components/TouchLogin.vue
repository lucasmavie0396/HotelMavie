<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';

interface TouchUser {
  id: number;
  name: string;
}

const emit = defineEmits<{ done: []; password: [] }>();

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const COLORS = ['bg-indigo-600', 'bg-rose-600', 'bg-emerald-600', 'bg-amber-600', 'bg-sky-600', 'bg-fuchsia-600', 'bg-teal-600', 'bg-orange-600'];

const { t } = useI18n();
const auth = useAuthStore();
const users = ref<TouchUser[] | null>(null);
const chosen = ref<TouchUser | null>(null);
const code = ref('');
const error = ref('');
const loading = ref(false);
const busy = ref(false);
const dots = computed(() => Math.max(4, code.value.length));

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
const color = (id: number) => COLORS[id % COLORS.length];

async function load() {
  loading.value = true;
  error.value = '';
  try {
    users.value = (await api.get<TouchUser[]>('/auth/touch-users')).data;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function pick(user: TouchUser) {
  chosen.value = user;
  code.value = '';
  error.value = '';
}

function back() {
  chosen.value = null;
  code.value = '';
  error.value = '';
}

function press(digit: string) {
  error.value = '';
  if (code.value.length < 6) code.value += digit;
}

function erase() {
  code.value = code.value.slice(0, -1);
}

async function confirm() {
  if (!chosen.value || code.value.length < 4 || busy.value) return;
  busy.value = true;
  try {
    await auth.loginPin(chosen.value.id, code.value);
    emit('done');
  } catch (e) {
    error.value = errorMessage(e);
    code.value = '';
  } finally {
    busy.value = false;
  }
}

function onKey(event: KeyboardEvent) {
  if (!chosen.value) return;
  if (/^\d$/.test(event.key)) press(event.key);
  else if (event.key === 'Backspace') erase();
  else if (event.key === 'Enter') confirm();
  else if (event.key === 'Escape') back();
}

onMounted(() => {
  load();
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="w-full max-w-4xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8" data-testid="touch-login">
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="flex size-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">M</div>
        <div>
          <h1 class="text-xl font-semibold">MAVIE-HGest</h1>
          <p class="text-sm text-slate-500">{{ t('touchLogin.tagline') }}</p>
        </div>
      </div>
      <div class="flex gap-2">
        <button v-if="!chosen" type="button" class="btn-secondary" :aria-label="t('touchLogin.refresh')" :title="t('touchLogin.refresh')" @click="load">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />
          </svg>
        </button>
        <button type="button" class="btn-secondary" @click="emit('password')">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" />
          </svg>
          {{ t('touchLogin.withPassword') }}
        </button>
      </div>
    </div>

    <div v-if="chosen" class="mx-auto max-w-xs">
      <button type="button" class="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-indigo-700" @click="back">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        {{ t('touchLogin.otherUser') }}
      </button>
      <div class="mb-4 text-center">
        <span class="mx-auto mb-2 flex size-16 items-center justify-center rounded-full text-2xl font-bold text-white" :class="color(chosen.id)" aria-hidden="true">{{ initials(chosen.name) }}</span>
        <p class="text-lg font-semibold">{{ chosen.name }}</p>
        <p class="text-sm text-slate-500">{{ t('touchLogin.enterCode') }}</p>
      </div>
      <div class="mb-4 flex h-8 justify-center gap-3" role="status" :aria-label="t('touchLogin.digits', { n: code.length })">
        <span v-for="index in dots" :key="index" class="size-4 self-center rounded-full" :class="index <= code.length ? 'bg-indigo-600' : 'border-2 border-slate-300'" />
      </div>
      <p v-if="error" class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-center text-sm text-rose-700" role="alert">{{ error }}</p>
      <div class="grid grid-cols-3 gap-3" :aria-label="t('touchLogin.keypad')">
        <button
          v-for="digit in KEYS"
          :key="digit"
          type="button"
          class="flex h-16 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white text-2xl font-semibold shadow-sm select-none active:scale-[0.97] active:bg-slate-100 disabled:opacity-50"
          :disabled="busy"
          @click="press(digit)"
        >
          {{ digit }}
        </button>
        <button
          type="button"
          class="flex h-16 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white shadow-sm select-none active:scale-[0.97] active:bg-slate-100 disabled:opacity-50"
          :disabled="busy || !code.length"
          :aria-label="t('login.keyDelete')"
          @click="erase"
        >
          <svg viewBox="0 0 24 24" class="size-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2zM18 9l-6 6M12 9l6 6" />
          </svg>
        </button>
        <button
          type="button"
          class="flex h-16 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white text-2xl font-semibold shadow-sm select-none active:scale-[0.97] active:bg-slate-100 disabled:opacity-50"
          :disabled="busy"
          @click="press('0')"
        >
          0
        </button>
        <button
          type="button"
          class="flex h-16 touch-manipulation items-center justify-center rounded-2xl border-2 border-indigo-600 bg-indigo-600 text-white shadow-sm select-none active:scale-[0.97] active:brightness-90 disabled:opacity-50"
          :disabled="busy || code.length < 4"
          :aria-label="t('login.submit')"
          @click="confirm"
        >
          <svg v-if="!busy" viewBox="0 0 24 24" class="size-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
          <span v-else class="size-6 animate-spin rounded-full border-4 border-white/40 border-t-white" aria-hidden="true" />
        </button>
      </div>
    </div>

    <template v-else>
      <h2 class="mb-3 text-lg font-semibold">{{ t('touchLogin.who') }}</h2>
      <p v-if="error" class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{{ error }}</p>
      <p v-if="loading && !users" class="text-sm text-slate-500">{{ t('touchLogin.loading') }}</p>
      <p v-if="users?.length === 0" class="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">{{ t('touchLogin.none') }}</p>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <button
          v-for="user in users"
          :key="user.id"
          type="button"
          class="flex min-h-32 touch-manipulation flex-col items-center justify-center gap-2 rounded-2xl border-2 border-slate-200 bg-white p-3 text-center shadow-sm transition select-none hover:border-indigo-500 active:scale-[0.98]"
          @click="pick(user)"
        >
          <span class="flex size-14 items-center justify-center rounded-full text-xl font-bold text-white" :class="color(user.id)" aria-hidden="true">{{ initials(user.name) }}</span>
          <span class="leading-tight font-semibold">{{ user.name }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

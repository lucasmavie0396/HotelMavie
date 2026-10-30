<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';

const { t } = useI18n();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const step = ref<'password' | 'code' | 'forgot'>('password');
const email = ref('');
const password = ref('');
const code = ref('');
const challenge = ref('');
const error = ref('');
const notice = ref('');
const loading = ref(false);

function safeRedirect() {
  const redirect = route.query.redirect;
  return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/';
}

async function attempt(action: () => Promise<void>) {
  error.value = '';
  loading.value = true;
  try {
    await action();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

const submit = () =>
  attempt(async () => {
    const pending = await auth.login(email.value, password.value);
    if (pending) {
      challenge.value = pending.challenge;
      code.value = '';
      step.value = 'code';
      return;
    }
    await router.push(safeRedirect());
  });

const submitCode = () =>
  attempt(async () => {
    await auth.loginTwoFactor(challenge.value, code.value.trim());
    await router.push(safeRedirect());
  });

const requestReset = () =>
  attempt(async () => {
    await api.post('/auth/forgot-password', { email: email.value });
    notice.value = t('login.resetSent');
    step.value = 'password';
  });

function show(value: 'password' | 'forgot') {
  error.value = '';
  notice.value = '';
  step.value = value;
}
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center px-4">
    <LanguageSwitcher class="absolute top-4 right-4" />
    <form v-if="step === 'password'" class="card w-full max-w-sm space-y-4" @submit.prevent="submit">
      <h1 class="text-xl font-semibold">{{ t('login.title') }}</h1>

      <label class="block space-y-1">
        <span class="text-sm font-medium">{{ t('login.email') }}</span>
        <input v-model="email" class="input" type="email" autocomplete="username" required />
      </label>

      <label class="block space-y-1">
        <span class="text-sm font-medium">{{ t('login.password') }}</span>
        <input v-model="password" class="input" type="password" autocomplete="current-password" required />
      </label>

      <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

      <button class="btn w-full" type="submit" :disabled="loading">
        {{ loading ? t('login.submitting') : t('login.submit') }}
      </button>
      <button class="w-full text-center text-sm text-indigo-600 hover:underline" type="button" @click="show('forgot')">{{ t('login.forgot') }}</button>
    </form>

    <form v-else-if="step === 'code'" class="card w-full max-w-sm space-y-4" @submit.prevent="submitCode">
      <h1 class="text-xl font-semibold">{{ t('login.twoFactorTitle') }}</h1>
      <p class="text-sm text-slate-600">{{ t('login.twoFactorText') }}</p>
      <label class="block space-y-1">
        <span class="text-sm font-medium">{{ t('login.code') }}</span>
        <input v-model="code" class="input text-center text-lg tracking-widest" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required autofocus />
      </label>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <button class="btn w-full" type="submit" :disabled="loading">{{ loading ? t('login.verifying') : t('login.confirm') }}</button>
      <button class="w-full text-center text-sm text-slate-500 hover:underline" type="button" @click="show('password')">{{ t('login.back') }}</button>
    </form>

    <form v-else class="card w-full max-w-sm space-y-4" @submit.prevent="requestReset">
      <h1 class="text-xl font-semibold">{{ t('login.resetTitle') }}</h1>
      <p class="text-sm text-slate-600">{{ t('login.resetText') }}</p>
      <label class="block space-y-1">
        <span class="text-sm font-medium">{{ t('login.email') }}</span>
        <input v-model="email" class="input" type="email" autocomplete="username" required />
      </label>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <button class="btn w-full" type="submit" :disabled="loading">{{ t('login.sendLink') }}</button>
      <button class="w-full text-center text-sm text-slate-500 hover:underline" type="button" @click="show('password')">{{ t('login.back') }}</button>
    </form>
  </div>
</template>

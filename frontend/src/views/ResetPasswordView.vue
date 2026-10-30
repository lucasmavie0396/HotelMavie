<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '@/services/api';

const { t } = useI18n();
const route = useRoute();
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));
const password = ref('');
const confirm = ref('');
const error = ref('');
const done = ref(false);
const loading = ref(false);

async function submit() {
  error.value = '';
  if (password.value !== confirm.value) {
    error.value = t('reset.mismatch');
    return;
  }
  loading.value = true;
  try {
    await api.post('/auth/reset-password', { token: token.value, password: password.value });
    done.value = true;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4">
    <div v-if="done" class="card w-full max-w-sm space-y-4">
      <h1 class="text-xl font-semibold">{{ t('reset.doneTitle') }}</h1>
      <p class="text-sm text-slate-600">{{ t('reset.doneText') }}</p>
      <RouterLink :to="{ name: 'login' }" class="btn w-full justify-center">{{ t('reset.login') }}</RouterLink>
    </div>
    <form v-else class="card w-full max-w-sm space-y-4" @submit.prevent="submit">
      <h1 class="text-xl font-semibold">{{ t('reset.title') }}</h1>
      <p v-if="!token" class="text-sm text-rose-600">{{ t('reset.invalid') }}</p>
      <label class="block space-y-1">
        <span class="text-sm font-medium">{{ t('reset.password') }}</span>
        <input v-model="password" class="input" type="password" autocomplete="new-password" minlength="8" required />
      </label>
      <label class="block space-y-1">
        <span class="text-sm font-medium">{{ t('reset.repeat') }}</span>
        <input v-model="confirm" class="input" type="password" autocomplete="new-password" minlength="8" required />
      </label>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <button class="btn w-full" type="submit" :disabled="loading || !token">{{ t('reset.save') }}</button>
      <RouterLink :to="{ name: 'login' }" class="block text-center text-sm text-slate-500 hover:underline">{{ t('reset.backToLogin') }}</RouterLink>
    </form>
  </div>
</template>

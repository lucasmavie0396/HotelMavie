<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

function safeRedirect() {
  const redirect = route.query.redirect;
  return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/';
}

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(email.value, password.value);
    await router.push(safeRedirect());
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4">
    <form class="card w-full max-w-sm space-y-4" @submit.prevent="submit">
      <h1 class="text-xl font-semibold">Entrar no MAVIE-HGest</h1>

      <label class="block space-y-1">
        <span class="text-sm font-medium">Email</span>
        <input v-model="email" class="input" type="email" autocomplete="username" required />
      </label>

      <label class="block space-y-1">
        <span class="text-sm font-medium">Password</span>
        <input v-model="password" class="input" type="password" autocomplete="current-password" required />
      </label>

      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

      <button class="btn w-full" type="submit" :disabled="loading">
        {{ loading ? 'A entrar...' : 'Entrar' }}
      </button>
    </form>
  </div>
</template>

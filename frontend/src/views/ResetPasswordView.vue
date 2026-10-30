<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '@/services/api';

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
    error.value = 'As passwords nao coincidem';
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
      <h1 class="text-xl font-semibold">Password alterada</h1>
      <p class="text-sm text-slate-600">Ja pode entrar com a nova password. As sessoes abertas noutros dispositivos foram terminadas.</p>
      <RouterLink :to="{ name: 'login' }" class="btn w-full justify-center">Entrar</RouterLink>
    </div>
    <form v-else class="card w-full max-w-sm space-y-4" @submit.prevent="submit">
      <h1 class="text-xl font-semibold">Definir nova password</h1>
      <p v-if="!token" class="text-sm text-rose-600">Link invalido. Peca um novo em "Esqueci-me da password".</p>
      <label class="block space-y-1">
        <span class="text-sm font-medium">Nova password</span>
        <input v-model="password" class="input" type="password" autocomplete="new-password" minlength="8" required />
      </label>
      <label class="block space-y-1">
        <span class="text-sm font-medium">Repetir password</span>
        <input v-model="confirm" class="input" type="password" autocomplete="new-password" minlength="8" required />
      </label>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <button class="btn w-full" type="submit" :disabled="loading || !token">Guardar password</button>
      <RouterLink :to="{ name: 'login' }" class="block text-center text-sm text-slate-500 hover:underline">Voltar ao login</RouterLink>
    </form>
  </div>
</template>

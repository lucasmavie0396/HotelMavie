<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';

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
    notice.value = 'Se o email existir, recebe uma mensagem com um link para repor a password (valido durante 60 minutos).';
    step.value = 'password';
  });

function show(value: 'password' | 'forgot') {
  error.value = '';
  notice.value = '';
  step.value = value;
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4">
    <form v-if="step === 'password'" class="card w-full max-w-sm space-y-4" @submit.prevent="submit">
      <h1 class="text-xl font-semibold">Entrar no MAVIE-HGest</h1>

      <label class="block space-y-1">
        <span class="text-sm font-medium">Email</span>
        <input v-model="email" class="input" type="email" autocomplete="username" required />
      </label>

      <label class="block space-y-1">
        <span class="text-sm font-medium">Password</span>
        <input v-model="password" class="input" type="password" autocomplete="current-password" required />
      </label>

      <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

      <button class="btn w-full" type="submit" :disabled="loading">
        {{ loading ? 'A entrar...' : 'Entrar' }}
      </button>
      <button class="w-full text-center text-sm text-indigo-600 hover:underline" type="button" @click="show('forgot')">Esqueci-me da password</button>
    </form>

    <form v-else-if="step === 'code'" class="card w-full max-w-sm space-y-4" @submit.prevent="submitCode">
      <h1 class="text-xl font-semibold">Verificacao em dois passos</h1>
      <p class="text-sm text-slate-600">Introduza o codigo de 6 digitos da aplicacao autenticadora, ou um codigo de recuperacao.</p>
      <label class="block space-y-1">
        <span class="text-sm font-medium">Codigo</span>
        <input v-model="code" class="input text-center text-lg tracking-widest" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required autofocus />
      </label>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <button class="btn w-full" type="submit" :disabled="loading">{{ loading ? 'A verificar...' : 'Confirmar' }}</button>
      <button class="w-full text-center text-sm text-slate-500 hover:underline" type="button" @click="show('password')">Voltar</button>
    </form>

    <form v-else class="card w-full max-w-sm space-y-4" @submit.prevent="requestReset">
      <h1 class="text-xl font-semibold">Repor password</h1>
      <p class="text-sm text-slate-600">Indique o email da conta. Enviamos um link para definir uma nova password.</p>
      <label class="block space-y-1">
        <span class="text-sm font-medium">Email</span>
        <input v-model="email" class="input" type="email" autocomplete="username" required />
      </label>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <button class="btn w-full" type="submit" :disabled="loading">Enviar link</button>
      <button class="w-full text-center text-sm text-slate-500 hover:underline" type="button" @click="show('password')">Voltar</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';

const { t } = useI18n();
const auth = useAuthStore();
const status = ref<{ enabled: boolean; recoveryCodesLeft: number } | null>(null);
const setup = ref<{ secret: string; qr: string } | null>(null);
const recoveryCodes = ref<string[]>([]);
const code = ref('');
const disable = reactive({ password: '', code: '' });
const error = ref('');
const busy = ref(false);

async function load() {
  try {
    status.value = (await api.get('/auth/2fa')).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const startSetup = () =>
  run(async () => {
    recoveryCodes.value = [];
    setup.value = (await api.post('/auth/2fa/setup')).data;
    code.value = '';
  });

const confirmSetup = () =>
  run(async () => {
    const { data } = await api.post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code: code.value.trim() });
    recoveryCodes.value = data.recoveryCodes;
    setup.value = null;
  });

const disableTwoFactor = () =>
  run(async () => {
    await api.post('/auth/2fa/disable', { password: disable.password, code: disable.code.trim() });
    Object.assign(disable, { password: '', code: '' });
  });

function copyCodes() {
  navigator.clipboard?.writeText(recoveryCodes.value.join('\n')).catch(() => undefined);
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="account" :subtitle="`${auth.user?.name} · ${auth.user?.email}`" />
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <div class="card flex max-w-2xl flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-semibold">{{ t('account.language') }}</h2>
        <p class="text-sm text-slate-600">{{ t('account.languageHint') }}</p>
      </div>
      <LanguageSwitcher />
    </div>

    <div class="card max-w-2xl space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">{{ t('account.twoFactor') }}</h2>
        <span
          v-if="status"
          class="rounded-full px-2.5 py-0.5 text-xs font-medium"
          :class="status.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'"
        >
          {{ status.enabled ? t('account.enabled', { count: status.recoveryCodesLeft }) : t('account.disabled') }}
        </span>
      </div>
      <p class="text-sm text-slate-600">{{ t('account.intro') }}</p>

      <div v-if="recoveryCodes.length" class="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p class="text-sm font-semibold text-amber-900">{{ t('account.recoveryWarning') }}</p>
        <ul class="grid grid-cols-2 gap-1 font-mono text-sm">
          <li v-for="item in recoveryCodes" :key="item">{{ item }}</li>
        </ul>
        <button class="btn-secondary" type="button" @click="copyCodes">{{ t('account.copy') }}</button>
      </div>

      <template v-if="status && !status.enabled">
        <button v-if="!setup" class="btn" type="button" :disabled="busy" @click="startSetup">{{ t('account.enable') }}</button>
        <form v-else class="grid gap-4 sm:grid-cols-[220px_1fr]" @submit.prevent="confirmSetup">
          <img :src="setup.qr" :alt="t('account.qrAlt')" class="size-[220px] rounded-lg border border-slate-200" />
          <div class="space-y-3 text-sm">
            <p>{{ t('account.step1') }}</p>
            <p>
              {{ t('account.manual') }}
              <code class="block rounded bg-slate-100 px-2 py-1 font-mono text-xs break-all">{{ setup.secret }}</code>
            </p>
            <label class="block space-y-1">
              <span>{{ t('account.step2') }}</span>
              <input v-model="code" class="input w-40 text-center tracking-widest" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required />
            </label>
            <div class="flex gap-2">
              <button class="btn" type="submit" :disabled="busy">{{ t('account.confirmEnable') }}</button>
              <button class="btn-secondary" type="button" @click="setup = null">{{ t('common.cancel') }}</button>
            </div>
          </div>
        </form>
      </template>

      <form v-else-if="status?.enabled" class="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_1fr_auto]" @submit.prevent="disableTwoFactor">
        <input v-model="disable.password" class="input" type="password" autocomplete="current-password" :placeholder="t('account.currentPassword')" required />
        <input v-model="disable.code" class="input" inputmode="numeric" maxlength="12" :placeholder="t('account.code')" required />
        <button class="btn-secondary text-rose-700" type="submit" :disabled="busy">{{ t('account.disable') }}</button>
      </form>
    </div>
  </section>
</template>

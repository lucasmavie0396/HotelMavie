<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { fileUrl, readImage } from '@/services/files';
import { useHotelsStore } from '@/stores/hotels';

const { t } = useI18n();
const hotels = useHotelsStore();
const error = ref('');
const notice = ref('');
const busy = ref(false);
const form = reactive({ publicDescription: '', publicDescriptionEn: '', depositPercent: 60, paymentInstructions: '', paymentInstructionsEn: '' });
const hotel = computed(() => hotels.selected);
const publicLink = computed(() => (hotel.value?.publicSlug ? `${window.location.origin}/h/${hotel.value.publicSlug}` : ''));

watch(
  hotel,
  (value) => {
    Object.assign(form, {
      publicDescription: value?.publicDescription ?? '',
      publicDescriptionEn: value?.publicDescriptionEn ?? '',
      depositPercent: Number(value?.depositPercent ?? 60),
      paymentInstructions: value?.paymentInstructions ?? '',
      paymentInstructionsEn: value?.paymentInstructionsEn ?? '',
    });
  },
  { immediate: true },
);

async function run(fn: () => Promise<unknown>, message: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
    await hotels.load(true);
    notice.value = message;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const save = () =>
  run(
    () =>
      api.patch(`/hotels/${hotels.selectedId}`, {
        publicDescription: form.publicDescription || null,
        publicDescriptionEn: form.publicDescriptionEn || null,
        depositPercent: Number(form.depositPercent),
        paymentInstructions: form.paymentInstructions || null,
        paymentInstructionsEn: form.paymentInstructionsEn || null,
      }),
    t('siteTab.saved'),
  );

async function uploadLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  await run(async () => api.post(`/hotels/${hotels.selectedId}/logo`, { data: await readImage(file, ['image/png', 'image/jpeg']) }), t('siteTab.logoUpdated'));
}

const removeLogo = () => run(() => api.delete(`/hotels/${hotels.selectedId}/logo`), t('siteTab.logoRemoved'));
</script>

<template>
  <div class="space-y-4">
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <div class="card flex flex-wrap items-center gap-6">
      <div class="flex h-24 w-48 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50">
        <img v-if="hotel?.logoFile" :src="fileUrl(hotel.logoFile)" :alt="t('siteTab.logoAlt')" class="max-h-20 max-w-44 object-contain" />
        <span v-else class="text-xs text-slate-400">{{ t('siteTab.noLogo') }}</span>
      </div>
      <div class="space-y-2 text-sm">
        <h2 class="font-semibold">{{ t('siteTab.logo') }}</h2>
        <p class="text-slate-600">{{ t('siteTab.logoHint') }}</p>
        <div class="flex gap-2">
          <label class="btn cursor-pointer" :class="busy ? 'pointer-events-none opacity-60' : ''">
            {{ hotel?.logoFile ? t('siteTab.replace') : t('siteTab.uploadLogo') }}
            <input class="hidden" type="file" accept="image/png,image/jpeg" @change="uploadLogo" />
          </label>
          <button v-if="hotel?.logoFile" class="btn-secondary" type="button" :disabled="busy" @click="removeLogo">{{ t('siteTab.remove') }}</button>
        </div>
      </div>
    </div>

    <form class="card grid gap-3 sm:grid-cols-2" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-2">{{ t('siteTab.title') }}</h2>
      <p class="text-sm text-slate-600 sm:col-span-2">
        <template v-if="publicLink && hotel?.publicEnabled">
          {{ t('siteTab.address') }} <a :href="publicLink" target="_blank" class="text-indigo-600 hover:underline">{{ publicLink }}</a>
        </template>
        <template v-else>{{ t('siteTab.disabled') }}</template>
        {{ t('siteTab.photosHint') }}
      </p>
      <label class="text-sm">
        {{ t('siteTab.description') }} (PT)
        <textarea v-model="form.publicDescription" class="input" rows="4" maxlength="5000" :placeholder="t('siteTab.descriptionPlaceholder')" />
      </label>
      <label class="text-sm">
        {{ t('siteTab.description') }} (EN)
        <textarea v-model="form.publicDescriptionEn" class="input" rows="4" maxlength="5000" :placeholder="t('siteTab.englishHint')" />
      </label>
      <label class="text-sm sm:col-span-2">
        {{ t('siteTab.deposit') }}
        <input v-model.number="form.depositPercent" class="input sm:w-48" type="number" min="0" max="100" step="0.01" required />
        <span class="text-xs text-slate-500">{{ t('siteTab.depositHint') }}</span>
      </label>
      <label class="text-sm">
        {{ t('siteTab.instructions') }} (PT)
        <textarea v-model="form.paymentInstructions" class="input" rows="4" maxlength="2000" :placeholder="t('siteTab.instructionsPlaceholder')" />
      </label>
      <label class="text-sm">
        {{ t('siteTab.instructions') }} (EN)
        <textarea v-model="form.paymentInstructionsEn" class="input" rows="4" maxlength="2000" :placeholder="t('siteTab.englishHint')" />
      </label>
      <div class="flex justify-end sm:col-span-2">
        <button class="btn" type="submit" :disabled="busy">{{ t('common.save') }}</button>
      </div>
    </form>
  </div>
</template>

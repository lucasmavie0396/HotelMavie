<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { fileUrl, readImage } from '@/services/files';
import type { ImageSearchResult, Product } from '@/types';

const props = defineProps<{ product: Product }>();
const emit = defineEmits<{ updated: [product: Product] }>();

const { t } = useI18n();
const error = ref('');
const busy = ref(false);
const searching = ref(false);
const panel = ref<'search' | 'link' | null>(null);
const query = ref(props.product.name);
const results = ref<ImageSearchResult[] | null>(null);
const provider = ref<'google' | 'wikimedia'>('wikimedia');
const link = ref('');
const choosing = ref('');

async function run(action: () => Promise<Product>) {
  busy.value = true;
  error.value = '';
  try {
    emit('updated', await action());
    panel.value = null;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
    choosing.value = '';
  }
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  await run(async () => (await api.post<Product>(`/products/${props.product.id}/image`, { data: await readImage(file) })).data);
}

async function search() {
  searching.value = true;
  error.value = '';
  try {
    const { data } = await api.get<{ provider: 'google' | 'wikimedia'; results: ImageSearchResult[] }>('/products/image-search', { params: { q: query.value } });
    provider.value = data.provider;
    results.value = data.results;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    searching.value = false;
  }
}

function openSearch() {
  panel.value = panel.value === 'search' ? null : 'search';
  if (panel.value === 'search' && !results.value) search();
}

const choose = (result: ImageSearchResult) => {
  choosing.value = result.url;
  return run(async () => {
    try {
      return (await api.post<Product>(`/products/${props.product.id}/image`, { url: result.url })).data;
    } catch (e) {
      if (result.thumb === result.url) throw e;
      return (await api.post<Product>(`/products/${props.product.id}/image`, { url: result.thumb })).data;
    }
  });
};

function openGoogle() {
  window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query.value || props.product.name)}`, '_blank', 'noopener');
  panel.value = 'link';
}

const fromLink = () => run(async () => (await api.post<Product>(`/products/${props.product.id}/image`, { url: link.value.trim() })).data);
const remove = () => run(async () => (await api.delete<Product>(`/products/${props.product.id}/image`)).data);
</script>

<template>
  <div class="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
    <div class="flex flex-wrap items-center gap-4">
      <div class="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
        <img v-if="product.imageFile" :src="fileUrl(product.imageFile)" :alt="product.name" class="h-full w-full object-cover" />
        <svg v-else viewBox="0 0 24 24" class="size-9 text-slate-300" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M4 16l4.6-4.6a2 2 0 012.8 0L16 16m-2-2l1.6-1.6a2 2 0 012.8 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <div class="space-y-2">
        <p class="text-sm font-semibold text-slate-700">{{ t('image.title') }}</p>
        <div class="flex flex-wrap gap-2">
          <label class="btn-secondary cursor-pointer px-3 py-1.5 text-xs" :class="busy ? 'pointer-events-none opacity-60' : ''">
            {{ t('image.computer') }}
            <input class="hidden" type="file" accept="image/png,image/jpeg,image/webp" @change="upload" />
          </label>
          <button class="btn px-3 py-1.5 text-xs" type="button" :disabled="busy" @click="openSearch">{{ t('image.search') }}</button>
          <button class="btn-secondary px-3 py-1.5 text-xs" type="button" @click="openGoogle">{{ t('image.google') }}</button>
          <button class="btn-secondary px-3 py-1.5 text-xs" type="button" :disabled="busy" @click="panel = panel === 'link' ? null : 'link'">{{ t('image.paste') }}</button>
          <button v-if="product.imageFile" class="px-2 text-xs text-rose-600 hover:underline" type="button" :disabled="busy" @click="remove">{{ t('common.remove') }}</button>
        </div>
      </div>
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>

    <p v-if="panel === 'link'" class="text-xs text-slate-600">
      {{ t('image.linkHint') }}
    </p>
    <form v-if="panel === 'link'" class="flex gap-2" @submit.prevent="fromLink">
      <input v-model="link" class="input" type="url" placeholder="https://.../foto.jpg" required />
      <button class="btn" type="submit" :disabled="busy">{{ busy ? t('image.downloading') : t('image.use') }}</button>
    </form>

    <div v-if="panel === 'search'" class="space-y-3">
      <form class="flex gap-2" @submit.prevent="search">
        <input v-model="query" class="input" :placeholder="t('image.searchExample')" minlength="2" maxlength="80" required />
        <button class="btn" type="submit" :disabled="searching">{{ searching ? t('site.search.searching') : t('common.search') }}</button>
      </form>
      <p v-if="results && !results.length" class="text-sm text-slate-500">{{ t('image.none') }}</p>
      <div v-if="results?.length" class="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
        <button
          v-for="result in results"
          :key="result.url"
          type="button"
          class="group relative aspect-square overflow-hidden rounded-lg bg-white ring-1 ring-slate-200 transition hover:ring-2 hover:ring-indigo-500 disabled:opacity-50"
          :title="`${result.title}${result.author ? ` · ${result.author}` : ''}${result.license ? ` · ${result.license}` : ''}`"
          :disabled="busy"
          @click="choose(result)"
        >
          <img :src="result.thumb" :alt="result.title" loading="lazy" referrerpolicy="no-referrer" class="h-full w-full object-cover" />
          <span class="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{{ result.license ?? result.author ?? (provider === 'google' ? 'Google' : 'Wikimedia') }}</span>
          <span v-if="choosing === result.url" class="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-indigo-700">{{ t('image.saving') }}</span>
        </button>
      </div>
      <p v-if="provider === 'google'" class="text-[11px] text-slate-500">
        {{ t('image.googleNote') }}
      </p>
      <p v-else class="text-[11px] text-slate-500">
        {{ t('image.wikimediaNote') }}
      </p>
    </div>
  </div>
</template>

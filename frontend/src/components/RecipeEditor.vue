<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { Product } from '@/types';
import { formatMoney } from '@/utils/format';

interface Recipe {
  items: { ingredientId: number; quantity: string; lineCost: string; ingredient: { name: string; unit: string; cost: string } }[];
  cost: string;
  netPrice: string;
  margin: string;
  marginPercent: number;
}

const props = defineProps<{ product: Product; ingredients: Product[] }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const hotels = useHotelsStore();
const recipe = ref<Recipe | null>(null);
const lines = ref<{ ingredientId: number; quantity: number }[]>([]);
const error = ref('');
const busy = ref(false);

const money = (value: string | number) => formatMoney(value, hotels.currency);
const available = computed(() => props.ingredients.filter((p) => p.id !== props.product.id && p.trackStock && p.active));
const draftCost = computed(() =>
  lines.value.reduce((sum, line) => sum + line.quantity * Number(available.value.find((p) => p.id === line.ingredientId)?.cost ?? 0), 0),
);

function fill(data: Recipe) {
  recipe.value = data;
  lines.value = data.items.map((item) => ({ ingredientId: item.ingredientId, quantity: Number(item.quantity) }));
}

async function save() {
  busy.value = true;
  error.value = '';
  try {
    fill((await api.put<Recipe>(`/products/${props.product.id}/recipe`, { items: lines.value.filter((l) => l.ingredientId) })).data);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    fill((await api.get<Recipe>(`/products/${props.product.id}/recipe`)).data);
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <div class="card space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="font-semibold">{{ t('recipe.title', { name: product.name }) }}</h2>
      <button class="text-sm text-slate-500 hover:underline" type="button" @click="emit('close')">{{ t('common.close') }}</button>
    </div>
    <p v-if="product.trackStock" class="text-sm text-amber-700">
      {{ t('recipe.ownStock') }}
    </p>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="!available.length" class="text-sm text-slate-500">
      {{ t('recipe.noIngredients') }}
    </p>

    <div v-for="(line, index) in lines" :key="index" class="grid grid-cols-[1fr_120px_100px_32px] items-center gap-2 text-sm">
      <select v-model.number="line.ingredientId" class="input">
        <option v-for="item in available" :key="item.id" :value="item.id">{{ item.name }} ({{ item.unit }})</option>
      </select>
      <input v-model.number="line.quantity" class="input" type="number" min="0.001" step="0.001" :aria-label="t('common.quantity')" />
      <span class="text-right text-slate-600">
        {{ money(line.quantity * Number(available.find((p) => p.id === line.ingredientId)?.cost ?? 0)) }}
      </span>
      <button class="text-rose-600" type="button" :aria-label="t('common.remove')" @click="lines.splice(index, 1)">&times;</button>
    </div>
    <button
      v-if="available.length"
      class="text-sm text-indigo-600 hover:underline"
      type="button"
      @click="lines.push({ ingredientId: available[0].id, quantity: 1 })"
    >
      {{ t('recipe.add') }}
    </button>

    <div v-if="recipe" class="grid gap-3 border-t border-slate-200 pt-3 text-sm sm:grid-cols-4">
      <div><p class="text-xs text-slate-500">{{ t('recipe.cost') }}</p><p class="font-semibold">{{ money(draftCost) }}</p></div>
      <div><p class="text-xs text-slate-500">{{ t('recipe.netPrice') }}</p><p class="font-semibold">{{ money(recipe.netPrice) }}</p></div>
      <div>
        <p class="text-xs text-slate-500">{{ t('recipe.margin') }}</p>
        <p class="font-semibold" :class="recipe.marginPercent < 60 ? 'text-amber-700' : 'text-emerald-700'">
          {{ money(recipe.margin) }} · {{ recipe.marginPercent }}%
        </p>
      </div>
      <div class="flex items-end justify-end">
        <button class="btn" type="button" :disabled="busy || product.trackStock" @click="save">{{ t('recipe.save') }}</button>
      </div>
    </div>
  </div>
</template>

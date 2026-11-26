<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import type { Product, ProductOptionGroup } from '@/types';

interface EditOption {
  id?: number;
  name: string;
  priceDelta: number;
  ingredientId: number;
  quantity: number;
}

interface EditGroup {
  id?: number;
  name: string;
  required: boolean;
  maxChoices: number;
  options: EditOption[];
}

const props = defineProps<{ product: Product; ingredients: Product[] }>();
const emit = defineEmits<{ close: [saved: boolean] }>();
const { t } = useI18n();
const groups = reactive<EditGroup[]>([]);
const error = ref('');
const busy = ref(false);
const stockProducts = computed(() => props.ingredients.filter((item) => item.trackStock && item.id !== props.product.id));

onMounted(async () => {
  try {
    const { data } = await api.get<ProductOptionGroup[]>(`/products/${props.product.id}/options`);
    groups.splice(
      0,
      groups.length,
      ...data.map((group) => ({
        id: group.id,
        name: group.name,
        required: group.required,
        maxChoices: group.maxChoices,
        options: group.options.map((option) => ({ id: option.id, name: option.name, priceDelta: Number(option.priceDelta), ingredientId: option.ingredientId ?? 0, quantity: Number(option.quantity) })),
      })),
    );
  } catch (e) {
    error.value = errorMessage(e);
  }
});

const newOption = (): EditOption => ({ name: '', priceDelta: 0, ingredientId: 0, quantity: 0 });

function addGroup() {
  groups.push({ name: '', required: true, maxChoices: 1, options: [newOption(), newOption()] });
}

async function save() {
  busy.value = true;
  error.value = '';
  try {
    await api.put(`/products/${props.product.id}/options`, {
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        required: group.required,
        maxChoices: Number(group.maxChoices),
        options: group.options
          .filter((option) => option.name.trim())
          .map((option) => ({ id: option.id, name: option.name, priceDelta: Number(option.priceDelta) || 0, ingredientId: option.ingredientId || null, quantity: option.ingredientId ? Number(option.quantity) : 0 })),
      })),
    });
    emit('close', true);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card space-y-4" data-testid="options-editor" @submit.prevent="save">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h2 class="font-semibold">{{ t('options.title', { name: product.name }) }}</h2>
        <p class="text-sm text-slate-500">{{ t('options.hint') }}</p>
      </div>
      <button class="text-sm text-slate-500 hover:underline" type="button" @click="emit('close', false)">{{ t('common.close') }}</button>
    </div>
    <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>

    <fieldset v-for="(group, groupIndex) in groups" :key="groupIndex" class="space-y-2 rounded-xl border border-slate-200 p-3">
      <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <label class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('options.group') }}</span>
          <input v-model="group.name" class="input" maxlength="60" :placeholder="t('options.groupExample')" required />
        </label>
        <label class="flex min-h-11 items-center gap-2 text-sm"><input v-model="group.required" type="checkbox" />{{ t('options.required') }}</label>
        <label class="text-sm">
          <span class="mb-1 block text-slate-600">{{ t('options.maxChoices') }}</span>
          <input v-model.number="group.maxChoices" class="input w-20" type="number" min="1" max="20" required />
        </label>
        <button class="btn-secondary text-rose-600" type="button" @click="groups.splice(groupIndex, 1)">{{ t('options.removeGroup') }}</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[40rem] text-sm">
          <thead class="text-left text-slate-600">
            <tr>
              <th class="py-1 pr-2">{{ t('options.option') }}</th>
              <th class="w-28 py-1 pr-2">{{ t('options.priceDelta') }}</th>
              <th class="py-1 pr-2">{{ t('options.ingredient') }}</th>
              <th class="w-28 py-1 pr-2">{{ t('options.quantity') }}</th>
              <th class="w-10"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(option, optionIndex) in group.options" :key="optionIndex">
              <td class="py-1 pr-2"><input v-model="option.name" class="input" maxlength="60" :aria-label="t('options.option')" /></td>
              <td class="py-1 pr-2"><input v-model.number="option.priceDelta" class="input" type="number" step="0.01" :aria-label="t('options.priceDelta')" /></td>
              <td class="py-1 pr-2">
                <select v-model.number="option.ingredientId" class="input" :aria-label="t('options.ingredient')">
                  <option :value="0">{{ t('options.noIngredient') }}</option>
                  <option v-for="item in stockProducts" :key="item.id" :value="item.id">{{ item.name }} ({{ item.unit }})</option>
                </select>
              </td>
              <td class="py-1 pr-2"><input v-model.number="option.quantity" class="input" type="number" min="0" step="0.001" :disabled="!option.ingredientId" :aria-label="t('options.quantity')" /></td>
              <td class="py-1"><button class="btn-icon text-rose-600" type="button" :aria-label="t('common.removeLine')" @click="group.options.splice(optionIndex, 1)">&times;</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button class="text-sm text-indigo-600 hover:underline" type="button" @click="group.options.push(newOption())">{{ t('options.addOption') }}</button>
    </fieldset>

    <div class="flex flex-wrap justify-between gap-2">
      <button class="btn-secondary" type="button" @click="addGroup">{{ t('options.addGroup') }}</button>
      <button class="btn" type="submit" :disabled="busy">{{ t('common.save') }}</button>
    </div>
  </form>
</template>

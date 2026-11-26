<script setup lang="ts">
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { useHotelsStore } from '@/stores/hotels';
import type { Product, ProductOptionGroup } from '@/types';
import { formatMoney } from '@/utils/format';

const props = defineProps<{ product: Product; groups: ProductOptionGroup[] }>();
const emit = defineEmits<{ confirm: [options: number[]]; cancel: [] }>();
const { t } = useI18n();
const hotels = useHotelsStore();
const chosen = reactive<Record<number, number[]>>(Object.fromEntries(props.groups.map((group) => [group.id, []])));
const money = (value: string | number) => formatMoney(value, hotels.currency);

function toggle(group: ProductOptionGroup, optionId: number) {
  const list = chosen[group.id];
  if (list.includes(optionId)) {
    list.splice(list.indexOf(optionId), 1);
  } else if (group.maxChoices === 1) {
    list.splice(0, list.length, optionId);
  } else if (list.length < group.maxChoices) {
    list.push(optionId);
  }
}

const missing = computed(() => props.groups.filter((group) => group.required && !chosen[group.id].length));
const price = computed(
  () =>
    Number(props.product.price) +
    props.groups.reduce((sum, group) => sum + group.options.filter((option) => chosen[group.id].includes(option.id)).reduce((part, option) => part + Number(option.priceDelta), 0), 0),
);
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center" role="dialog" aria-modal="true" :aria-label="product.name">
    <div class="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" data-testid="options-dialog">
      <h2 class="text-lg font-semibold">{{ product.name }}</h2>
      <section v-for="group in groups" :key="group.id" class="space-y-2">
        <h3 class="text-sm font-semibold text-slate-700">
          {{ group.name }}
          <span class="font-normal text-slate-500">· {{ group.required ? t('options.choose', { n: group.maxChoices }) : t('options.optional', { n: group.maxChoices }) }}</span>
        </h3>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="option in group.options"
            :key="option.id"
            type="button"
            class="min-h-12 touch-manipulation rounded-xl border-2 px-3 py-2 text-left text-sm"
            :class="chosen[group.id].includes(option.id) ? 'border-indigo-600 bg-indigo-50 font-semibold' : 'border-slate-200 bg-white'"
            :aria-pressed="chosen[group.id].includes(option.id)"
            @click="toggle(group, option.id)"
          >
            {{ option.name }}
            <span v-if="Number(option.priceDelta)" class="block text-xs text-slate-500">{{ Number(option.priceDelta) > 0 ? '+' : '' }}{{ money(option.priceDelta) }}</span>
          </button>
        </div>
      </section>
      <div class="grid grid-cols-2 gap-2">
        <button class="btn-secondary min-h-12" type="button" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button class="btn min-h-12" type="button" :disabled="missing.length > 0" @click="emit('confirm', Object.values(chosen).flat())">
          {{ t('options.add', { price: money(price) }) }}
        </button>
      </div>
    </div>
  </div>
</template>

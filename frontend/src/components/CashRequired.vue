<script setup lang="ts">
import { toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useOwnCash } from '@/composables/cashGuard';
import type { CashRegister } from '@/types';

const props = defineProps<{ registers: CashRegister[] }>();
const { t } = useI18n();
const hasCash = useOwnCash(toRef(props, 'registers'));
</script>

<template>
  <div v-if="!hasCash" class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
    <span>{{ t('payment.cashRequired') }}</span>
    <RouterLink :to="{ name: 'cash' }" class="btn-secondary px-3 py-1 text-xs">{{ t('payment.openCash') }}</RouterLink>
  </div>
</template>

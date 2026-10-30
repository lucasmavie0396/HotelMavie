<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePaymentTypesStore } from '@/stores/paymentTypes';
import type { CashRegister } from '@/types';

const props = defineProps<{ registers?: CashRegister[] }>();
const typeId = defineModel<number>('typeId', { required: true });
const cashSessionId = defineModel<number>('cashSessionId', { default: 0 });
const reference = defineModel<string>('reference', { default: '' });

const { t } = useI18n();
const types = usePaymentTypesStore();
const selected = computed(() => types.byId(typeId.value));
const sessions = computed(() =>
  (props.registers ?? []).flatMap((register) => register.sessions.map((session) => ({ id: session.id, label: register.name }))),
);

function ensureSelection() {
  if (!types.active.some((type) => type.id === typeId.value)) {
    typeId.value = types.active.find((type) => type.kind === 'CARD')?.id ?? types.active[0]?.id ?? 0;
  }
  if (selected.value?.kind === 'CASH' && !cashSessionId.value) {
    cashSessionId.value = sessions.value[0]?.id ?? 0;
  }
}

watch(() => [types.active, typeId.value, sessions.value], ensureSelection);
onMounted(async () => {
  await types.load();
  ensureSelection();
});
defineExpose({ needsSession: () => selected.value?.kind === 'CASH' && !cashSessionId.value });
</script>

<template>
  <select v-model.number="typeId" class="input" :aria-label="t('payment.type')">
    <option v-for="type in types.active" :key="type.id" :value="type.id">{{ type.name }}</option>
  </select>
  <select v-if="selected?.kind === 'CASH'" v-model.number="cashSessionId" class="input" :aria-label="t('payment.register')" required>
    <option v-if="!sessions.length" :value="0" disabled>{{ t('payment.noRegister') }}</option>
    <option v-for="session in sessions" :key="session.id" :value="session.id">{{ t('payment.registerName', { name: session.label }) }}</option>
  </select>
  <input
    v-model="reference"
    class="input"
    :placeholder="selected?.requiresReference ? t('payment.referenceRequired', { name: selected.name }) : t('payment.referenceOptional')"
    :required="selected?.requiresReference"
  />
</template>

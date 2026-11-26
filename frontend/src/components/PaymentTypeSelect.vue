<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { usePaymentTypesStore } from '@/stores/paymentTypes';
import type { CashRegister } from '@/types';

const props = defineProps<{ registers?: CashRegister[]; buttons?: boolean; noEventCard?: boolean }>();
const typeId = defineModel<number>('typeId', { required: true });
const cashSessionId = defineModel<number>('cashSessionId', { default: 0 });
const reference = defineModel<string>('reference', { default: '' });
const cardNumber = defineModel<string>('cardNumber', { default: '' });

const { t } = useI18n();
const auth = useAuthStore();
const types = usePaymentTypesStore();
const available = computed(() => types.active.filter((type) => !props.noEventCard || !type.isEventCard));
const selected = computed(() => types.byId(typeId.value));
const sessions = computed(() =>
  (props.registers ?? [])
    .flatMap((register) => register.sessions.map((session) => ({ id: session.id, label: register.name, own: session.openedById === auth.user?.id })))
    .sort((a, b) => Number(b.own) - Number(a.own)),
);

function ensureSelection() {
  if (!available.value.some((type) => type.id === typeId.value)) {
    typeId.value = available.value.find((type) => type.kind === 'CARD')?.id ?? available.value[0]?.id ?? 0;
  }
  if (selected.value?.kind === 'CASH' && !cashSessionId.value) {
    cashSessionId.value = sessions.value[0]?.id ?? 0;
  }
}

watch(() => [available.value, typeId.value, sessions.value], ensureSelection);
onMounted(async () => {
  await types.load();
  ensureSelection();
});
defineExpose({ needsSession: () => selected.value?.kind === 'CASH' && !cashSessionId.value });
</script>

<template>
  <div v-if="props.buttons" class="grid grid-cols-2 gap-2" role="radiogroup" :aria-label="t('payment.type')">
    <button
      v-for="type in available"
      :key="type.id"
      type="button"
      role="radio"
      :aria-checked="typeId === type.id"
      :class="typeId === type.id ? 'btn' : 'btn-secondary'"
      @click="typeId = type.id"
    >
      {{ type.name }}
    </button>
  </div>
  <select v-else v-model.number="typeId" class="input" :aria-label="t('payment.type')">
    <option v-for="type in available" :key="type.id" :value="type.id">{{ type.name }}</option>
  </select>
  <select v-if="selected?.kind === 'CASH'" v-model.number="cashSessionId" class="input" :aria-label="t('payment.register')" required>
    <option v-if="!sessions.length" :value="0" disabled>{{ t('payment.noRegister') }}</option>
    <option v-for="session in sessions" :key="session.id" :value="session.id">{{ t('payment.registerName', { name: session.label }) }}</option>
  </select>
  <input
    v-if="selected?.isEventCard"
    v-model="cardNumber"
    class="input"
    :placeholder="t('cards.readCard')"
    :aria-label="t('cards.readCard')"
    autocomplete="off"
    required
    data-testid="event-card-number"
  />
  <input
    v-else
    v-model="reference"
    class="input"
    :placeholder="selected?.requiresReference ? t('payment.referenceRequired', { name: selected.name }) : t('payment.referenceOptional')"
    :required="selected?.requiresReference"
  />
</template>

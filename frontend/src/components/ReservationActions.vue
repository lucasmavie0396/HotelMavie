<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  ACTION_LABELS,
  availableActions,
  runReservationAction,
  type ReservationAction,
} from '@/composables/reservationActions';
import { errorMessage } from '@/services/api';
import type { Reservation } from '@/types';

const props = defineProps<{ reservation: Reservation }>();
const emit = defineEmits<{ updated: [reservation: Reservation]; error: [message: string] }>();

const busy = ref(false);
const actions = computed(() => availableActions(props.reservation));

async function run(action: ReservationAction) {
  busy.value = true;
  try {
    const updated = await runReservationAction(props.reservation.id, action);
    if (updated) {
      emit('updated', updated);
    }
  } catch (e) {
    emit('error', errorMessage(e));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="action in actions"
      :key="action"
      type="button"
      :disabled="busy"
      :class="['cancel', 'no-show'].includes(action) ? 'btn-secondary' : 'btn'"
      class="px-3 py-1 text-xs"
      @click="run(action)"
    >
      {{ ACTION_LABELS[action] }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ReservationStatus } from '@/types';
import { RESERVATION_STATUS_CLASSES, RESERVATION_STATUS_LABELS } from '@/utils/format';

defineProps<{ status: ReservationStatus }>();
</script>

<template>
  <span class="rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap" :class="RESERVATION_STATUS_CLASSES[status]">
    {{ RESERVATION_STATUS_LABELS[status] }}
  </span>
</template>

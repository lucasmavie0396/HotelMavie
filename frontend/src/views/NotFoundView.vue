<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
    <h1 class="text-2xl font-semibold">{{ t('notFound.title') }}</h1>
    <RouterLink to="/" class="btn">{{ t('notFound.home') }}</RouterLink>
  </div>
</template>

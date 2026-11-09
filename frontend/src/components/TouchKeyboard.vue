<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ numeric?: boolean; enterLabel: string }>();
const emit = defineEmits<{ key: [value: string]; backspace: []; enter: [] }>();

const { t } = useI18n();
const shift = ref(false);
const symbols = ref(false);

const LETTERS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SYMBOLS = ['1234567890', '!#$%&*()+=', '/?:;,\'"[]', '<>{}|~^'];

const rows = computed(() =>
  (symbols.value ? SYMBOLS : LETTERS).map((row) => [...row].map((char) => (shift.value && !symbols.value ? char.toUpperCase() : char))),
);

function press(value: string) {
  emit('key', value);
  shift.value = false;
}

const key = 'flex h-12 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-lg bg-white text-lg font-medium text-slate-800 shadow-sm ring-1 ring-slate-200 select-none active:bg-indigo-100 sm:h-14';
const action = 'flex h-12 min-w-0 touch-manipulation items-center justify-center rounded-lg bg-slate-200 text-sm font-semibold text-slate-700 select-none active:bg-slate-300 sm:h-14';
const enterKey = 'flex h-12 min-w-0 touch-manipulation items-center justify-center rounded-lg bg-indigo-600 text-sm font-semibold text-white select-none active:bg-indigo-700 sm:h-14';
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-1.5 rounded-t-2xl bg-slate-100 p-2 shadow-lg ring-1 ring-slate-200" :aria-label="t('login.keyboard')" @mousedown.prevent>
    <template v-if="props.numeric">
      <div v-for="row in ['123', '456', '789']" :key="row" class="flex gap-1.5">
        <button v-for="char in row" :key="char" type="button" :class="key" @click="press(char)">{{ char }}</button>
      </div>
      <div class="flex gap-1.5">
        <button type="button" :class="[action, 'flex-1']" :aria-label="t('login.keyDelete')" @click="emit('backspace')">⌫</button>
        <button type="button" :class="key" @click="press('0')">0</button>
        <button type="button" :class="[enterKey, 'flex-1']" @click="emit('enter')">{{ props.enterLabel }}</button>
      </div>
    </template>

    <template v-else>
      <div v-for="(row, index) in rows" :key="index" class="flex gap-1.5">
        <button v-if="index === 3 && !symbols" type="button" :class="[action, 'flex-[1.5]', shift ? 'bg-indigo-200 text-indigo-900' : '']" :aria-label="t('login.keyShift')" :aria-pressed="shift" @click="shift = !shift">⇧</button>
        <button v-for="char in row" :key="char" type="button" :class="key" @click="press(char)">{{ char }}</button>
        <button v-if="index === 3" type="button" :class="[action, 'flex-[1.5]']" :aria-label="t('login.keyDelete')" @click="emit('backspace')">⌫</button>
      </div>
      <div class="flex gap-1.5">
        <button type="button" :class="[action, 'flex-[1.5]']" @click="symbols = !symbols">{{ symbols ? 'abc' : '#+=' }}</button>
        <button v-for="char in ['@', '.', '-', '_']" :key="char" type="button" :class="key" @click="press(char)">{{ char }}</button>
        <button type="button" :class="[enterKey, 'flex-[2.5]']" @click="emit('enter')">{{ props.enterLabel }}</button>
      </div>
    </template>
  </div>
</template>

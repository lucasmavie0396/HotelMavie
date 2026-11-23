<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { acceptsKeyboard, isNumericField, isTouchScreen, onKeyboardModeChange, readKeyboardMode, typeInto, type KeyboardMode } from '@/utils/screen';

type Layer = 'letters' | 'accents' | 'symbols';

const LETTERS = ['1234567890', 'qwertyuiop', 'asdfghjklç', 'zxcvbnm'];
const ACCENTS = ['1234567890', 'áàâãéêíóôõ', 'úüçÁÀÂÃÉÊ', 'ÍÓÔÕÚÇ'];
const SYMBOLS = ['1234567890', '-/:;()$&@#', '.,?!\'"%*+=', '_<>[]{}'];
const DIGITS = ['789', '456', '123'];

const { t } = useI18n();
const mode = ref<KeyboardMode>(readKeyboardMode());
const field = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
const layer = ref<Layer>('letters');
const shift = ref(false);
const buffer = ref('');
const panel = ref<HTMLElement | null>(null);

const active = computed(() => mode.value === 'always' || (mode.value === 'auto' && isTouchScreen()));
const numeric = computed(() => (field.value ? isNumericField(field.value) : false));
const multiline = computed(() => field.value instanceof HTMLTextAreaElement);
const numberInput = computed(() => field.value instanceof HTMLInputElement && field.value.type === 'number');
const rows = computed(() => (layer.value === 'letters' ? LETTERS : layer.value === 'accents' ? ACCENTS : SYMBOLS));

function show(target: EventTarget | null) {
  if (!active.value || !acceptsKeyboard(target) || field.value === target) return;
  field.value = target;
  buffer.value = target.value;
  layer.value = 'letters';
  shift.value = false;
  window.setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
}

function enter(event: FocusEvent) {
  show(event.target);
}

function tap(event: PointerEvent) {
  show(event.target);
}

function leave(event: FocusEvent) {
  if (panel.value?.contains(event.relatedTarget as Node)) return;
  window.setTimeout(() => {
    if (!acceptsKeyboard(document.activeElement)) field.value = null;
  }, 60);
}

function writeNumber(next: string) {
  const element = field.value as HTMLInputElement;
  buffer.value = next;
  if (next === '' || /^-?\d*\.?\d+$/.test(next) || /^-?\d+$/.test(next)) {
    element.value = next;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function write(text: string) {
  if (!field.value) return;
  if (numberInput.value) {
    const value = text === ',' ? '.' : text;
    if (value === '.' && buffer.value.includes('.')) return;
    writeNumber(`${buffer.value}${value}`);
    return;
  }
  const upper = shift.value && layer.value === 'letters';
  typeInto(field.value, upper ? text.toUpperCase() : text);
  if (upper) shift.value = false;
}

function erase() {
  if (!field.value) return;
  if (numberInput.value) {
    writeNumber(buffer.value.slice(0, -1));
    return;
  }
  typeInto(field.value, '', true);
}

function close() {
  field.value?.blur();
  field.value = null;
}

function newLine() {
  if (field.value instanceof HTMLTextAreaElement) typeInto(field.value, '\n');
  else close();
}

watch(
  [field, layer, numeric],
  async () => {
    await nextTick();
    const height = field.value ? (panel.value?.offsetHeight ?? 0) : 0;
    document.body.style.paddingBottom = height ? `${height}px` : '';
    if (height) document.documentElement.style.setProperty('--keyboard-height', `${height}px`);
    else document.documentElement.style.removeProperty('--keyboard-height');
  },
  { flush: 'post' },
);

watch(active, (value) => {
  if (!value) field.value = null;
});

let stopModeListener: (() => void) | null = null;

onMounted(() => {
  document.addEventListener('focusin', enter);
  document.addEventListener('focusout', leave);
  document.addEventListener('pointerdown', tap, true);
  show(document.activeElement);
  stopModeListener = onKeyboardModeChange((value) => (mode.value = value));
});

onBeforeUnmount(() => {
  document.removeEventListener('focusin', enter);
  document.removeEventListener('focusout', leave);
  document.removeEventListener('pointerdown', tap, true);
  stopModeListener?.();
  document.body.style.paddingBottom = '';
  document.documentElement.style.removeProperty('--keyboard-height');
});

const key = 'flex min-h-12 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-lg bg-white text-lg font-medium text-slate-800 shadow-sm ring-1 ring-slate-300 select-none active:bg-indigo-100';
const primary = 'flex min-h-12 touch-manipulation items-center justify-center rounded-lg bg-indigo-600 px-3 text-base font-semibold text-white shadow-sm select-none active:bg-indigo-700';
const special = 'flex min-h-12 touch-manipulation items-center justify-center rounded-lg bg-slate-200 px-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-300 select-none active:bg-slate-300';
</script>

<template>
  <div
    v-if="field"
    ref="panel"
    role="group"
    :aria-label="t('screen.keyboard')"
    data-screen-keyboard
    class="fixed inset-x-0 bottom-0 z-[1000] border-t border-slate-300 bg-slate-100/95 p-2 shadow-[0_-4px_16px_rgba(0,0,0,0.15)] backdrop-blur print:hidden"
    @pointerdown.prevent
    @mousedown.prevent
  >
    <div v-if="numeric" class="mx-auto grid max-w-md grid-cols-4 gap-1.5">
      <div v-for="(row, index) in DIGITS" :key="row" class="col-span-3 grid grid-cols-3 gap-1.5" :style="{ gridRow: index + 1 }">
        <button v-for="char in row" :key="char" type="button" tabindex="-1" :class="key" @click="write(char)">{{ char }}</button>
      </div>
      <button type="button" tabindex="-1" :class="special" style="grid-column: 4; grid-row: 1 / span 2" :aria-label="t('screen.erase')" @click="erase">⌫</button>
      <button type="button" tabindex="-1" :class="primary" style="grid-column: 4; grid-row: 3 / span 2" @click="close">OK</button>
      <div class="col-span-3 grid grid-cols-3 gap-1.5" style="grid-row: 4">
        <button type="button" tabindex="-1" :class="key" @click="write('0')">0</button>
        <button type="button" tabindex="-1" :class="key" @click="write('00')">00</button>
        <button type="button" tabindex="-1" :class="key" :aria-label="t('screen.decimal')" @click="write(',')">,</button>
      </div>
    </div>

    <div v-else class="mx-auto flex max-w-5xl flex-col gap-1.5">
      <div v-for="(row, index) in rows" :key="row" class="flex gap-1.5">
        <button
          v-if="index === 3 && layer === 'letters'"
          type="button"
          tabindex="-1"
          :class="[special, shift ? 'bg-indigo-200 text-indigo-900' : '']"
          :aria-label="t('screen.shift')"
          :aria-pressed="shift"
          @click="shift = !shift"
        >
          ⇧
        </button>
        <button v-for="char in row" :key="char" type="button" tabindex="-1" :class="key" @click="write(char)">
          {{ shift && layer === 'letters' ? char.toUpperCase() : char }}
        </button>
        <button v-if="index === 3" type="button" tabindex="-1" :class="special" :aria-label="t('screen.erase')" @click="erase">⌫</button>
      </div>
      <div class="flex gap-1.5">
        <button type="button" tabindex="-1" :class="special" @click="layer = layer === 'symbols' ? 'letters' : 'symbols'">{{ layer === 'symbols' ? 'abc' : '?123' }}</button>
        <button type="button" tabindex="-1" :class="special" @click="layer = layer === 'accents' ? 'letters' : 'accents'">{{ layer === 'accents' ? 'abc' : 'áç' }}</button>
        <button type="button" tabindex="-1" :class="[key, 'flex-[5]']" :aria-label="t('screen.space')" @click="write(' ')">{{ t('screen.space') }}</button>
        <button type="button" tabindex="-1" :class="[primary, 'min-w-24']" @click="newLine">
          {{ multiline ? '↵' : 'OK' }}
        </button>
        <button type="button" tabindex="-1" :class="special" :aria-label="t('screen.hide')" @click="close">▾</button>
      </div>
    </div>
  </div>
</template>

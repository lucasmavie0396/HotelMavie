import { computed } from 'vue';
import { createI18n } from 'vue-i18n';
import { messages } from './messages';

export type Locale = 'pt' | 'en';

export const LOCALES: { value: Locale; label: string; name: string }[] = [
  { value: 'pt', label: 'PT', name: 'Portugues' },
  { value: 'en', label: 'EN', name: 'English' },
];

const STORAGE_KEY = 'mavie.lang';

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'pt' || stored === 'en') return stored;
  } catch {
    return 'pt';
  }
  const browser = typeof navigator === 'undefined' ? 'pt' : (navigator.languages?.[0] ?? navigator.language ?? 'pt');
  return browser.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'pt',
  messages,
  missingWarn: false,
  fallbackWarn: false,
});

export const t = i18n.global.t;

export const locale = computed(() => i18n.global.locale.value as Locale);

export function localeTag() {
  return locale.value === 'en' ? 'en-GB' : 'pt-PT';
}

export function setLocale(value: Locale) {
  i18n.global.locale.value = value;
  document.documentElement.lang = localeTag();
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    return;
  }
}

export function translated<K extends string>(prefix: string, keys: readonly K[]): Record<K, string> {
  const record = {} as Record<K, string>;
  for (const key of keys) {
    Object.defineProperty(record, key, { enumerable: true, get: () => t(`${prefix}.${key}`) });
  }
  return record;
}

if (typeof document !== 'undefined') document.documentElement.lang = localeTag();

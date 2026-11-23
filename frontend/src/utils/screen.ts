export interface ScreenSettings {
  touch: boolean;
  scale: number;
}

export type KeyboardMode = 'auto' | 'always' | 'never';

export const SCALES = [90, 100, 110, 125] as const;
export const KEYBOARD_MODES: KeyboardMode[] = ['auto', 'always', 'never'];

const SCREEN_KEY = 'mavie.ecra';
const KEYBOARD_KEY = 'mavie.teclado';
const MENU_KEY = 'mavie.menu';
const KEYBOARD_EVENT = 'mavie-keyboard';

export function isTouchScreen() {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
}

export function readScreen(): ScreenSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SCREEN_KEY) ?? 'null') as Partial<ScreenSettings> | null;
    if (value) {
      return { touch: value.touch === true, scale: SCALES.includes(value.scale as never) ? (value.scale as number) : 100 };
    }
  } catch {
    return { touch: false, scale: 100 };
  }
  return { touch: isTouchScreen(), scale: 100 };
}

export function applyScreen(settings: ScreenSettings = readScreen()) {
  const html = document.documentElement;
  html.style.fontSize = settings.scale === 100 ? '' : `${settings.scale}%`;
  if (settings.touch) html.dataset.touch = '1';
  else delete html.dataset.touch;
}

export function saveScreen(settings: ScreenSettings) {
  try {
    localStorage.setItem(SCREEN_KEY, JSON.stringify(settings));
  } catch {
    applyScreen(settings);
    return;
  }
  applyScreen(settings);
}

export function readKeyboardMode(): KeyboardMode {
  try {
    const value = localStorage.getItem(KEYBOARD_KEY);
    if (value === 'auto' || value === 'always' || value === 'never') return value;
  } catch {
    return 'auto';
  }
  return 'auto';
}

export function saveKeyboardMode(mode: KeyboardMode) {
  try {
    localStorage.setItem(KEYBOARD_KEY, mode);
  } catch {
    window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, { detail: mode }));
    return;
  }
  window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, { detail: mode }));
}

export function onKeyboardModeChange(listener: (mode: KeyboardMode) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<KeyboardMode>).detail);
  window.addEventListener(KEYBOARD_EVENT, handler);
  return () => window.removeEventListener(KEYBOARD_EVENT, handler);
}

export function readMenuCollapsed() {
  try {
    const value = localStorage.getItem(MENU_KEY);
    if (value === '1' || value === '0') return value === '1';
  } catch {
    return window.innerWidth < 1280;
  }
  return window.innerWidth < 1280;
}

export function saveMenuCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(MENU_KEY, collapsed ? '1' : '0');
  } catch {
    return;
  }
}

const TEXT_TYPES = new Set(['text', 'search', 'tel', 'email', 'password', 'url', 'number']);

export function acceptsKeyboard(element: EventTarget | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled && !('noKeyboard' in element.dataset);
  if (!(element instanceof HTMLInputElement)) return false;
  return TEXT_TYPES.has(element.type) && !element.readOnly && !element.disabled && !('noKeyboard' in element.dataset);
}

export function isNumericField(element: HTMLInputElement | HTMLTextAreaElement) {
  return (element instanceof HTMLInputElement && element.type === 'number') || ['decimal', 'numeric'].includes(element.inputMode);
}

export function typeInto(element: HTMLInputElement | HTMLTextAreaElement, text: string, erase = false) {
  const value = element.value;
  let start = value.length;
  let end = value.length;
  try {
    if (element.selectionStart !== null && element.selectionEnd !== null) {
      start = element.selectionStart;
      end = element.selectionEnd;
    }
  } catch {
    start = value.length;
  }
  if (erase && start === end) start = Math.max(0, start - 1);
  const next = value.slice(0, start) + (erase ? '' : text) + value.slice(end);
  if (element.maxLength > 0 && next.length > element.maxLength) return;
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, next);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  const cursor = start + (erase ? 0 : text.length);
  try {
    element.setSelectionRange(cursor, cursor);
  } catch {
    return;
  }
}

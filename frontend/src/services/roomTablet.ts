import axios from 'axios';
import { locale } from '@/i18n';

const STORAGE_KEY = 'mavie.tablet-quarto';

export function readTabletToken() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveTabletToken(token: string | null) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export const tabletApi = axios.create({ baseURL: '/api/room-device' });

tabletApi.interceptors.request.use((config) => {
  config.headers['X-Lang'] = locale.value;
  const token = readTabletToken();
  if (token) config.headers['X-Room-Device'] = token;
  return config;
});

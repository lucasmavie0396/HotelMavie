import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { locale, t } from '@/i18n';
import { useAuthStore } from '@/stores/auth';

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

export const api = axios.create({ baseURL: '/api' });

let refreshing: Promise<'ok' | 'expired' | 'unavailable'> | null = null;

api.interceptors.request.use((config) => {
  config.headers['X-Lang'] = locale.value;
  const auth = useAuthStore();
  if (auth.accessToken) {
    config.headers.Authorization = `Bearer ${auth.accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    if (error.response?.status !== 401 || !original || original._retry || /^\/auth\/(login|refresh|logout|forgot-password|reset-password)/.test(original.url ?? '')) {
      return Promise.reject(error);
    }

    original._retry = true;
    refreshing ??= useAuthStore()
      .refresh()
      .finally(() => {
        refreshing = null;
      });

    const result = await refreshing;
    if (result === 'ok') {
      return api(original);
    }
    if (result === 'expired') {
      window.location.assign('/login');
    }
    return Promise.reject(error);
  },
);

export async function openPdf(path: string, params?: Record<string, unknown>) {
  const { data } = await api.get<Blob>(path, { params, responseType: 'blob' });
  const url = URL.createObjectURL(data);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function openInvoicePdf(id: number, kind: 'invoices' | 'receipts' = 'invoices', format?: 'ticket') {
  return openPdf(`/${kind}/${id}/pdf`, format ? { format } : undefined);
}

export async function emailInvoice(id: number, fullNumber: string) {
  const to = window.prompt(t('common.emailPrompt', { number: fullNumber }), '');
  if (to === null) {
    return null;
  }
  const { data } = await api.post<{ status: 'SENT' | 'LOGGED' | 'FAILED'; recipient: string }>(`/invoices/${id}/email`, {
    to: to.trim() || undefined,
  });
  window.alert(data.status === 'SENT' ? t('common.emailSent', { to: data.recipient }) : t('common.emailLogged', { to: data.recipient }));
  return data;
}

export function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string | string[] } | undefined)?.message;
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    return message ?? t('common.networkError');
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return t('common.unexpectedError');
}

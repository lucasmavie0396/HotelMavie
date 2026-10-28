import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth';

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

export const api = axios.create({ baseURL: '/api' });

let refreshing: Promise<'ok' | 'expired' | 'unavailable'> | null = null;

api.interceptors.request.use((config) => {
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
    if (error.response?.status !== 401 || !original || original._retry || original.url?.startsWith('/auth/')) {
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

export async function openInvoicePdf(id: number, kind: 'invoices' | 'receipts' = 'invoices') {
  const { data } = await api.get<Blob>(`/${kind}/${id}/pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function emailInvoice(id: number, fullNumber: string) {
  const to = window.prompt(`Enviar ${fullNumber} para (vazio = email do cliente):`, '');
  if (to === null) {
    return null;
  }
  const { data } = await api.post<{ status: 'SENT' | 'LOGGED' | 'FAILED'; recipient: string }>(`/invoices/${id}/email`, {
    to: to.trim() || undefined,
  });
  window.alert(
    data.status === 'SENT'
      ? `Enviado para ${data.recipient}`
      : `Registado para ${data.recipient}, mas nao enviado: o servidor de email (SMTP) nao esta configurado.`,
  );
  return data;
}

export function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string | string[] } | undefined)?.message;
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    return message ?? 'Erro de comunicacao com o servidor';
  }
  return 'Erro inesperado';
}

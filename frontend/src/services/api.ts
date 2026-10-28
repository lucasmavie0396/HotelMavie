import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth';

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

export const api = axios.create({ baseURL: '/api' });

let refreshing: Promise<boolean> | null = null;

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

    if (await refreshing) {
      return api(original);
    }
    window.location.assign('/login');
    return Promise.reject(error);
  },
);

export async function openInvoicePdf(id: number) {
  const { data } = await api.get<Blob>(`/invoices/${id}/pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

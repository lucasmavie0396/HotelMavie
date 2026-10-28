import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/services/api';
import type { AuthUser } from '@/types';

interface Session {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const STORAGE_KEY = 'mavie-hgest-session';

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(loadSession());

  const accessToken = computed(() => session.value?.accessToken ?? null);
  const user = computed(() => session.value?.user ?? null);
  const isAuthenticated = computed(() => session.value !== null);

  function setSession(value: Session | null) {
    session.value = value;
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  }

  async function login(email: string, password: string) {
    const { data } = await api.post<Session>('/auth/login', { email, password });
    setSession(data);
  }

  async function refresh(): Promise<'ok' | 'expired' | 'unavailable'> {
    if (!session.value) {
      return 'expired';
    }
    try {
      const { data } = await api.post<Session>('/auth/refresh', { refreshToken: session.value.refreshToken });
      setSession(data);
      return 'ok';
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 401 || status === 400) {
        setSession(null);
        return 'expired';
      }
      return 'unavailable';
    }
  }

  async function logout() {
    await api.post('/auth/logout', { refreshToken: session.value?.refreshToken }).catch(() => undefined);
    setSession(null);
  }

  return { accessToken, user, isAuthenticated, login, refresh, logout };
});

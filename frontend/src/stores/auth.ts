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
    const { data } = await api.post<Session | { twoFactorRequired: true; challenge: string }>('/auth/login', { email, password });
    if ('twoFactorRequired' in data) return { challenge: data.challenge };
    setSession(data);
    return null;
  }

  async function loginTwoFactor(challenge: string, code: string) {
    const { data } = await api.post<Session>('/auth/login/2fa', { challenge, code });
    setSession(data);
  }

  function adoptNewerSession(usedRefreshToken: string) {
    const stored = loadSession();
    if (stored && stored.refreshToken !== usedRefreshToken) {
      session.value = stored;
      return true;
    }
    return false;
  }

  async function refresh(): Promise<'ok' | 'expired' | 'unavailable'> {
    if (!session.value) {
      return 'expired';
    }
    const used = session.value.refreshToken;
    if (adoptNewerSession(used)) {
      return 'ok';
    }
    try {
      const { data } = await api.post<Session>('/auth/refresh', { refreshToken: used });
      setSession(data);
      return 'ok';
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 401 || status === 400) {
        for (let attempt = 0; attempt < 10; attempt++) {
          if (adoptNewerSession(used)) {
            return 'ok';
          }
          await new Promise((done) => setTimeout(done, 200));
        }
        setSession(null);
        return 'expired';
      }
      return 'unavailable';
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) {
        session.value = event.newValue ? (JSON.parse(event.newValue) as Session) : null;
      }
    });
  }

  async function logout() {
    await api.post('/auth/logout', { refreshToken: session.value?.refreshToken }).catch(() => undefined);
    setSession(null);
  }

  return { accessToken, user, isAuthenticated, login, loginTwoFactor, refresh, logout };
});

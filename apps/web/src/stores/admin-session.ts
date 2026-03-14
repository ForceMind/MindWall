import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { adminLogout, fetchAdminSession } from '@/lib/admin-api';
import { clearAdminToken, loadAdminToken, saveAdminToken } from '@/lib/storage';

interface AdminSession {
  username: string;
  expires_at: string | null;
  auth_mode: 'session' | 'token';
}

export const useAdminSessionStore = defineStore('adminSession', () => {
  const token = ref('');
  const session = ref<AdminSession | null>(null);
  const bootstrapped = ref(false);
  const loading = ref(false);

  const isAuthenticated = computed(() => Boolean(token.value));

  function hydrate() {
    if (token.value) {
      return;
    }
    token.value = loadAdminToken();
  }

  function setSession(nextToken: string, nextSession: AdminSession) {
    token.value = nextToken;
    saveAdminToken(nextToken);
    session.value = nextSession;
    bootstrapped.value = true;
  }

  async function refreshSession() {
    if (!token.value) {
      session.value = null;
      bootstrapped.value = true;
      return null;
    }

    loading.value = true;
    try {
      const payload = await fetchAdminSession(token.value);
      session.value = payload;
      bootstrapped.value = true;
      return payload;
    } catch {
      clearSession();
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function ensureBootstrap() {
    hydrate();
    if (!token.value) {
      bootstrapped.value = true;
      return null;
    }
    if (bootstrapped.value && session.value) {
      return session.value;
    }
    return refreshSession();
  }

  function clearSession() {
    token.value = '';
    session.value = null;
    bootstrapped.value = true;
    clearAdminToken();
  }

  async function logout() {
    if (token.value) {
      try {
        await adminLogout(token.value);
      } catch {
      }
    }
    clearSession();
  }

  return {
    token,
    session,
    loading,
    bootstrapped,
    isAuthenticated,
    hydrate,
    setSession,
    refreshSession,
    ensureBootstrap,
    clearSession,
    logout,
  };
});

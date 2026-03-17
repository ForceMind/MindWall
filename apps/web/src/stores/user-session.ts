import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AuthResponse, ViewerPayload } from '@/lib/user-api';
import { fetchCurrentUser, logoutUser } from '@/lib/user-api';
import { clearUserToken, loadUserToken, saveUserToken } from '@/lib/storage';

export const useUserSessionStore = defineStore('userSession', () => {
  const token = ref('');
  const viewer = ref<ViewerPayload | null>(null);
  const bootstrapped = ref(false);
  const loading = ref(false);

  const isAuthenticated = computed(() => Boolean(token.value));
  const isActive = computed(() => viewer.value?.user.status === 'active');
  const needsOnboarding = computed(() => viewer.value?.user.status === 'onboarding');

  function hydrate() {
    if (token.value) {
      return;
    }
    token.value = loadUserToken();
  }

  function setSession(payload: AuthResponse) {
    token.value = payload.session_token;
    saveUserToken(payload.session_token);
    viewer.value = {
      user: payload.user,
      profile: payload.profile,
      public_tags: payload.public_tags,
    };
    bootstrapped.value = true;
  }

  function setViewer(payload: ViewerPayload) {
    viewer.value = payload;
    bootstrapped.value = true;
  }

  async function refreshViewer() {
    if (!token.value) {
      viewer.value = null;
      bootstrapped.value = true;
      return null;
    }

    loading.value = true;
    try {
      const payload = await fetchCurrentUser(token.value);
      viewer.value = payload;
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
    if (bootstrapped.value && viewer.value) {
      return viewer.value;
    }
    return refreshViewer();
  }

  function clearSession() {
    token.value = '';
    viewer.value = null;
    bootstrapped.value = true;
    clearUserToken();
  }

  async function logout() {
    if (token.value) {
      try {
        await logoutUser(token.value);
      } catch {
      }
    }
    clearSession();
  }

  return {
    token,
    viewer,
    loading,
    bootstrapped,
    isAuthenticated,
    isActive,
    needsOnboarding,
    hydrate,
    setSession,
    setViewer,
    refreshViewer,
    ensureBootstrap,
    clearSession,
    logout,
  };
});

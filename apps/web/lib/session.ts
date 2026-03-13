export const authTokenStorageKey = "mindwall_auth_token";

export function getStoredToken() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(authTokenStorageKey) || "";
}

export function storeToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(authTokenStorageKey, token);
}

export function clearStoredToken() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(authTokenStorageKey);
}

export function getAuthHeaders(init?: Record<string, string>) {
  const token = getStoredToken();
  return {
    ...(init || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

import { apiBaseUrl } from "./config";

const adminTokenStorageKey = "mindwall_admin_session_token";

export function getStoredAdminToken() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(adminTokenStorageKey) || "";
}

export function storeAdminToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(adminTokenStorageKey, token);
}

export function clearStoredAdminToken() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(adminTokenStorageKey);
}

export function getAdminHeaders(init?: Record<string, string>) {
  const token = getStoredAdminToken();
  return {
    ...(init || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export type AdminSession = {
  username: string;
  expires_at: string | null;
  auth_mode: string;
};

export async function fetchAdminSession() {
  const token = getStoredAdminToken();
  if (!token) {
    return null;
  }

  const response = await fetch(`${apiBaseUrl}/admin/auth/session`, {
    headers: getAdminHeaders(),
  });

  if (response.status === 401) {
    clearStoredAdminToken();
    return null;
  }

  if (!response.ok) {
    throw new Error(`读取后台登录状态失败：${response.status}`);
  }

  return (await response.json()) as AdminSession;
}

export async function logoutAdmin() {
  const response = await fetch(`${apiBaseUrl}/admin/auth/logout`, {
    method: "POST",
    headers: getAdminHeaders({
      "Content-Type": "application/json",
    }),
  });

  clearStoredAdminToken();

  if (!response.ok && response.status !== 401) {
    throw new Error(`退出后台失败：${response.status}`);
  }
}

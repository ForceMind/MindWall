import { apiBaseUrl } from "./config";
import { clearStoredToken, getAuthHeaders } from "./session";

export type Viewer = {
  user: {
    id: string;
    email: string;
    status: string;
    created_at: string;
  };
  profile: {
    real_name: string | null;
    real_avatar: string | null;
    city: string | null;
    is_wall_broken: boolean;
  } | null;
  public_tags: Array<{
    tag_name: string;
    weight: number;
    ai_justification: string;
  }>;
};

export async function fetchCurrentViewer() {
  const response = await fetch(`${apiBaseUrl}/auth/me`, {
    headers: getAuthHeaders(),
  });

  if (response.status === 401) {
    clearStoredToken();
    return null;
  }
  if (!response.ok) {
    throw new Error(`获取当前登录状态失败：${response.status}`);
  }

  return (await response.json()) as Viewer;
}

export async function logout() {
  const response = await fetch(`${apiBaseUrl}/auth/logout`, {
    method: "POST",
    headers: getAuthHeaders({
      "Content-Type": "application/json",
    }),
  });

  clearStoredToken();

  if (!response.ok && response.status !== 401) {
    throw new Error(`退出登录失败：${response.status}`);
  }
}

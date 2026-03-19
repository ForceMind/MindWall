import { httpRequest } from './http';

export type UserStatus = 'onboarding' | 'active' | 'restricted';

function adminHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function adminLogin(username: string, password: string) {
  return httpRequest<{
    session_token: string;
    username: string;
    expires_at: string;
  }>('/admin/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

export function fetchAdminSession(token: string) {
  return httpRequest<{
    username: string;
    expires_at: string | null;
    auth_mode: 'session' | 'token';
  }>('/admin/auth/session', {
    headers: adminHeaders(token),
  });
}

export function adminLogout(token: string) {
  return httpRequest<{ status: 'ok' }>('/admin/auth/logout', {
    method: 'POST',
    headers: adminHeaders(token),
  });
}

export function fetchAdminOverview(token: string) {
  return httpRequest<{
    registered_users: number;
    active_sessions: number;
    online_users: number;
    user_status: Record<UserStatus, number>;
    ai_usage: {
      total_calls: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_tokens: number;
      total_estimated_cost_usd: number;
      today_calls: number;
      today_tokens: number;
      today_estimated_cost_usd: number;
    };
  }>('/admin/dashboard/overview', {
    headers: adminHeaders(token),
  });
}

export function fetchAdminUsers(token: string, page: number, limit: number) {
  return httpRequest<{
    page: number;
    limit: number;
    total: number;
    users: Array<{
      id: string;
      username: string | null;
      status: UserStatus;
      created_at: string;
      online: boolean;
      profile: {
        anonymous_name: string | null;
        city: string | null;
        gender: string | null;
        age: number | null;
      } | null;
    }>;
  }>(`/admin/dashboard/users?page=${page}&limit=${limit}`, {
    headers: adminHeaders(token),
  });
}

export function fetchAdminUserDetail(token: string, userId: string) {
  return httpRequest<Record<string, unknown>>(`/admin/dashboard/users/${userId}/detail`, {
    headers: adminHeaders(token),
  });
}

export function updateAdminUserStatus(token: string, userId: string, status: UserStatus) {
  return httpRequest<{ id: string; status: UserStatus }>(
    `/admin/dashboard/users/${userId}/status`,
    {
      method: 'PUT',
      headers: adminHeaders(token),
      body: { status },
    },
  );
}

export function fetchAdminOnlineUsers(token: string, minutes = 10) {
  return httpRequest<{
    window_minutes: number;
    total_online: number;
    users: Array<{
      user_id: string;
      username: string | null;
      status: UserStatus;
      last_seen_at: string;
      profile: {
        anonymous_name: string | null;
        city: string | null;
      } | null;
    }>;
  }>(`/admin/dashboard/online?minutes=${minutes}`, {
    headers: adminHeaders(token),
  });
}

export function fetchAdminAiRecords(token: string, page: number, limit: number) {
  return httpRequest<{
    page: number;
    limit: number;
    total: number;
    summary: {
      total_input_tokens: number;
      total_output_tokens: number;
      total_tokens: number;
      total_estimated_cost_usd: number;
      unique_user_count: number;
    };
    records: Array<{
      id: string;
      user_id: string | null;
      feature: string;
      prompt_key: string | null;
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
      created_at: string;
    }>;
  }>(`/admin/dashboard/ai-records?page=${page}&limit=${limit}`, {
    headers: adminHeaders(token),
  });
}

export function fetchAdminPrompts(token: string) {
  return httpRequest<Array<{
    key: string;
    name: string;
    category: string;
    content: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>>('/admin/dashboard/prompts', {
    headers: adminHeaders(token),
  });
}

export function updateAdminPrompt(
  token: string,
  key: string,
  payload: {
    name?: string;
    category?: string;
    content?: string;
    is_active?: boolean;
  },
) {
  return httpRequest<Record<string, unknown>>(`/admin/dashboard/prompts/${key}`, {
    method: 'PUT',
    headers: adminHeaders(token),
    body: payload,
  });
}

export function fetchAdminConfig(token: string) {
  return httpRequest<{
    openai_base_url: string;
    openai_api_key_configured: boolean;
    openai_api_key_preview: string | null;
    openai_embedding_api_key_configured: boolean;
    openai_embedding_api_key_preview: string | null;
    openai_model: string;
    openai_embedding_model: string;
    web_origin: string;
    source: Record<string, string>;
    updated_at: string | null;
    config_file: string;
  }>('/admin/config', {
    headers: adminHeaders(token),
  });
}

export function saveAdminConfig(
  token: string,
  payload: Partial<{
    openai_base_url: string;
    openai_api_key: string;
    openai_embedding_api_key: string;
    openai_model: string;
    openai_embedding_model: string;
    web_origin: string;
  }>,
) {
  return httpRequest('/admin/config', {
    method: 'PUT',
    headers: adminHeaders(token),
    body: payload,
  });
}

export function testAdminConfig(
  token: string,
  payload: Partial<{
    openai_base_url: string;
    openai_api_key: string;
    openai_embedding_api_key: string;
    openai_model: string;
    openai_embedding_model: string;
  }>,
) {
  return httpRequest<{
    ok: boolean;
    message: string;
    base_url: string;
    chat_model: string;
    embedding_model: string;
    chat: {
      ok: boolean;
      status: number | null;
      latency_ms: number | null;
      preview: string;
      error: string | null;
    };
    embedding: {
      ok: boolean;
      status: number | null;
      latency_ms: number | null;
      vector_size: number | null;
      error: string | null;
    };
  }>('/admin/config/test', {
    method: 'POST',
    headers: adminHeaders(token),
    body: payload,
  });
}

export function fetchAdminLogs(token: string, lines = 300, category = '', level = '') {
  let url = `/admin/dashboard/logs?lines=${lines}`;
  if (category) url += `&category=${encodeURIComponent(category)}`;
  if (level) url += `&level=${encodeURIComponent(level)}`;
  return httpRequest<{
    file: string;
    available: boolean;
    total_lines: number;
    lines: string[];
  }>(url, {
    headers: adminHeaders(token),
  });
}

export interface AdminMatch {
  id: string;
  status: string;
  resonance_score: number;
  ai_match_reason: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
  wall_broken_at: string | null;
  user_a: { user_id: string; username: string | null; anonymous_name: string | null; city: string | null };
  user_b: { user_id: string; username: string | null; anonymous_name: string | null; city: string | null };
}

export interface AdminMatchMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  ai_action: string;
  original_text: string;
  ai_rewritten_text: string;
  created_at: string;
}

export interface AdminCompanionSession {
  id: string;
  user_id: string;
  persona_id: string;
  persona_name: string;
  status: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  user: { user_id: string; username: string | null; anonymous_name: string | null; city: string | null };
}

export interface AdminCompanionMessage {
  id: string;
  sender_type: string;
  sender_name: string;
  original_text: string | null;
  ai_rewritten_text: string;
  ai_action: string;
  created_at: string;
}

export function fetchAdminMatches(token: string, page: number, limit: number, tab = '', search = '') {
  let url = `/admin/dashboard/matches?page=${page}&limit=${limit}`;
  if (tab) url += `&tab=${encodeURIComponent(tab)}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  return httpRequest<{
    page: number;
    limit: number;
    total: number;
    matches: AdminMatch[];
  }>(url, {
    headers: adminHeaders(token),
  });
}

export function fetchAdminCompanionSessions(token: string, page: number, limit: number, tab = '', search = '') {
  let url = `/admin/dashboard/companion-sessions?page=${page}&limit=${limit}`;
  if (tab) url += `&tab=${encodeURIComponent(tab)}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  return httpRequest<{
    page: number;
    limit: number;
    total: number;
    sessions: AdminCompanionSession[];
  }>(url, {
    headers: adminHeaders(token),
  });
}

export function fetchAdminCompanionSessionMessages(token: string, sessionId: string) {
  return httpRequest<{
    session: {
      id: string;
      user_id: string;
      user_name: string;
      persona_id: string;
      persona_name: string;
      status: string;
    };
    total: number;
    messages: AdminCompanionMessage[];
  }>(`/admin/dashboard/companion-sessions/${sessionId}/messages`, {
    headers: adminHeaders(token),
  });
}

export function fetchAdminMatchMessages(token: string, matchId: string, page: number, limit: number) {
  return httpRequest<{
    match: {
      id: string;
      user_a_id: string;
      user_b_id: string;
      status: string;
      resonance_score: number;
      wall_broken_at: string | null;
    };
    page: number;
    limit: number;
    total: number;
    messages: AdminMatchMessage[];
  }>(`/admin/dashboard/matches/${matchId}/messages?page=${page}&limit=${limit}`, {
    headers: adminHeaders(token),
  });
}

// ---- Backup & Restore ----

export function fetchAdminBackupInfo(token: string) {
  return httpRequest<{
    users: number;
    profiles: number;
    tags: number;
    matches: number;
    sandbox_messages: number;
    companion_sessions: number;
    companion_messages: number;
    interview_records: number;
    ai_logs: number;
  }>('/admin/backup/info', {
    headers: adminHeaders(token),
  });
}

export async function downloadAdminBackup(token: string) {
  const { apiBaseUrl } = await import('./config').then(m => ({ apiBaseUrl: m.appConfig.apiBaseUrl }));
  const url = `${apiBaseUrl}/admin/backup/download`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  const blob = await response.blob();
  const filename = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
    || `mindwall-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function uploadAdminRestore(token: string, file: File) {
  const { apiBaseUrl } = await import('./config').then(m => ({ apiBaseUrl: m.appConfig.apiBaseUrl }));
  const url = `${apiBaseUrl}/admin/backup/restore`;
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error((detail as any).message || `Restore failed: ${response.status}`);
  }
  return response.json() as Promise<{ status: string; restored: Record<string, number> }>;
}

export function adminResetAllData(token: string) {
  return httpRequest<{ status: string; message: string }>('/admin/backup/reset', {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
}

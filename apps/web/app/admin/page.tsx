"use client";

import { useEffect, useState } from 'react';
import { AppLoadingScreen, AuthShell } from '../../components/app-shell';
import {
  clearStoredAdminToken,
  fetchAdminSession,
  getAdminHeaders,
  logoutAdmin,
  type AdminSession,
} from '../../lib/admin-session';
import { apiBaseUrl } from '../../lib/config';

type Overview = {
  registered_users: number;
  active_sessions: number;
  online_users: number;
  user_status: {
    onboarding: number;
    active: number;
    restricted: number;
  };
  ai_usage: {
    total_records: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  };
};

type DashboardUser = {
  id: string;
  username: string | null;
  status: 'onboarding' | 'active' | 'restricted';
  created_at: string;
  online: boolean;
  profile: {
    anonymous_name: string | null;
    city: string | null;
    gender: string | null;
    age: number | null;
  } | null;
};

type UsersResult = {
  total: number;
  page: number;
  limit: number;
  users: DashboardUser[];
};

type OnlineResult = {
  total_online: number;
  users: Array<{
    user_id: string;
    username: string | null;
    status: string;
    last_seen_at: string;
    profile: {
      anonymous_name: string | null;
      city: string | null;
    } | null;
  }>;
};

type AiRecordResult = {
  total: number;
  page: number;
  limit: number;
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
};

type PromptTemplate = {
  id: string;
  key: string;
  name: string;
  category: string;
  version: number;
  is_active: boolean;
  content: string;
  updated_at: string;
};

type LogsResult = {
  file: string;
  count: number;
  lines: string[];
};

type AdminConfig = {
  openai_base_url: string;
  openai_api_key_configured: boolean;
  openai_api_key_preview: string | null;
  openai_model: string;
  openai_embedding_model: string;
  web_origin: string;
  source: {
    openai_base_url: string;
    openai_api_key: string;
    openai_model: string;
    openai_embedding_model: string;
    web_origin: string;
  };
  updated_at: string | null;
  config_file: string;
};

type UserDetail = {
  user: {
    id: string;
    auth_provider_id: string;
    username: string | null;
    status: 'onboarding' | 'active' | 'restricted';
    created_at: string;
  };
  profile: {
    real_name: string | null;
    real_avatar: string | null;
    anonymous_name: string | null;
    anonymous_avatar: string | null;
    gender: string | null;
    age: number | null;
    city: string | null;
    is_wall_broken: boolean;
    updated_at: string;
  } | null;
  presence: {
    online: boolean;
    active_sessions: number;
    last_seen_at: string | null;
  };
  stats: {
    total_matches: number;
    sent_messages: number;
    blocked_messages: number;
    modified_messages: number;
    passed_messages: number;
    ai_calls: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  };
  tags: {
    public: Array<{ tag_name: string; weight: number; ai_justification: string; created_at: string }>;
    hidden: Array<{ tag_name: string; weight: number; ai_justification: string; created_at: string }>;
  };
  recent: {
    sessions: Array<{
      id: string;
      created_at: string;
      last_seen_at: string;
      expires_at: string;
      revoked_at: string | null;
      is_active: boolean;
    }>;
    ai_records: Array<{
      id: string;
      feature: string;
      prompt_key: string | null;
      model: string;
      total_tokens: number;
      estimated_cost_usd: number;
      created_at: string;
    }>;
    matches: Array<{
      id: string;
      status: string;
      resonance_score: number;
      created_at: string;
      updated_at: string;
      counterpart: {
        user_id: string;
        username: string | null;
        anonymous_name: string | null;
        city: string | null;
      };
    }>;
    messages: Array<{
      id: string;
      match_id: string;
      ai_action: string;
      ai_rewritten_text: string;
      created_at: string;
      counterpart: {
        user_id: string;
        username: string | null;
        anonymous_name: string | null;
      };
    }>;
    logs: Array<{
      ts: string;
      level: string;
      event: string;
      message: string;
    }>;
  };
  timeline: Array<{
    ts: string;
    type: string;
    title: string;
    detail: string;
  }>;
};

const defaultBaseUrl = 'https://api.openai.com/v1';
const defaultChatModel = 'gpt-4.1-mini';
const defaultEmbeddingModel = 'text-embedding-3-small';
const defaultWebOrigin = 'http://localhost:3001';

export default function AdminPage() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UsersResult | null>(null);
  const [online, setOnline] = useState<OnlineResult | null>(null);
  const [aiRecords, setAiRecords] = useState<AiRecordResult | null>(null);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [logs, setLogs] = useState<LogsResult | null>(null);
  const [config, setConfig] = useState<AdminConfig | null>(null);

  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [apiKey, setApiKey] = useState('');
  const [chatModel, setChatModel] = useState(defaultChatModel);
  const [embeddingModel, setEmbeddingModel] = useState(defaultEmbeddingModel);
  const [webOrigin, setWebOrigin] = useState(defaultWebOrigin);
  const [clearApiKey, setClearApiKey] = useState(false);

  const [updatingUserId, setUpdatingUserId] = useState('');
  const [savingPromptKey, setSavingPromptKey] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      try {
        const adminSession = await fetchAdminSession();
        if (!adminSession) {
          clearStoredAdminToken();
          window.location.replace('/admin/login');
          return;
        }

        setSession(adminSession);
        await loadAll();
      } catch (err) {
        setError((err as Error).message || '读取后台状态失败。');
      } finally {
        setChecking(false);
      }
    }

    void bootstrap();
  }, []);

  function applyConfig(payload: AdminConfig) {
    setConfig(payload);
    setBaseUrl(payload.openai_base_url || defaultBaseUrl);
    setChatModel(payload.openai_model || defaultChatModel);
    setEmbeddingModel(payload.openai_embedding_model || defaultEmbeddingModel);
    setWebOrigin(payload.web_origin || defaultWebOrigin);
  }

  async function authFetch(path: string, init?: RequestInit) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...getAdminHeaders(),
      },
    });

    if (response.status === 401) {
      clearStoredAdminToken();
      window.location.replace('/admin/login');
      throw new Error('后台登录已失效，请重新登录。');
    }

    return response;
  }

  async function loadAll() {
    setLoading(true);
    setError('');

    try {
      const [
        overviewRes,
        usersRes,
        onlineRes,
        aiRes,
        promptsRes,
        logsRes,
        configRes,
      ] = await Promise.all([
        authFetch('/admin/dashboard/overview'),
        authFetch('/admin/dashboard/users?page=1&limit=20'),
        authFetch('/admin/dashboard/online?minutes=10'),
        authFetch('/admin/dashboard/ai-records?page=1&limit=20'),
        authFetch('/admin/dashboard/prompts'),
        authFetch('/admin/dashboard/logs?lines=120'),
        authFetch('/admin/config'),
      ]);

      if (
        !overviewRes.ok ||
        !usersRes.ok ||
        !onlineRes.ok ||
        !aiRes.ok ||
        !promptsRes.ok ||
        !logsRes.ok ||
        !configRes.ok
      ) {
        throw new Error('后台数据读取失败，请稍后重试。');
      }

      const [
        overviewPayload,
        usersPayload,
        onlinePayload,
        aiPayload,
        promptsPayload,
        logsPayload,
        configPayload,
      ] = await Promise.all([
        overviewRes.json() as Promise<Overview>,
        usersRes.json() as Promise<UsersResult>,
        onlineRes.json() as Promise<OnlineResult>,
        aiRes.json() as Promise<AiRecordResult>,
        promptsRes.json() as Promise<PromptTemplate[]>,
        logsRes.json() as Promise<LogsResult>,
        configRes.json() as Promise<AdminConfig>,
      ]);

      setOverview(overviewPayload);
      setUsers(usersPayload);
      setOnline(onlinePayload);
      setAiRecords(aiPayload);
      setPrompts(promptsPayload);
      setLogs(logsPayload);
      applyConfig(configPayload);
      setVirtualPromptDraft(promptsPayload);
      setSuccess('后台数据已刷新。');
    } catch (err) {
      setError((err as Error).message || '后台数据读取失败。');
    } finally {
      setLoading(false);
    }
  }

  const [promptDraft, setPromptDraft] = useState<Record<string, PromptTemplate>>({});

  function setVirtualPromptDraft(items: PromptTemplate[]) {
    const draft: Record<string, PromptTemplate> = {};
    for (const item of items) {
      draft[item.key] = { ...item };
    }
    setPromptDraft(draft);
  }

  async function loadUserDetail(userId: string) {
    setSelectedUserId(userId);
    setLoadingUserDetail(true);
    setError('');

    try {
      const response = await authFetch(`/admin/dashboard/users/${userId}/detail`);
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as UserDetail;
      setUserDetail(payload);
    } catch (err) {
      setError((err as Error).message || '读取用户详情失败。');
      setUserDetail(null);
      setSelectedUserId('');
    } finally {
      setLoadingUserDetail(false);
    }
  }

  function closeUserDetail() {
    setSelectedUserId('');
    setUserDetail(null);
    setLoadingUserDetail(false);
  }

  async function handleUpdateUserStatus(userId: string, status: DashboardUser['status']) {
    setUpdatingUserId(userId);
    setError('');

    try {
      const response = await authFetch(`/admin/dashboard/users/${userId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminHeaders(),
        },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await Promise.all([loadAll()]);
      setSuccess('用户状态已更新。');
    } catch (err) {
      setError((err as Error).message || '更新用户状态失败。');
    } finally {
      setUpdatingUserId('');
    }
  }

  async function handleSavePrompt(key: string) {
    const draft = promptDraft[key];
    if (!draft) {
      return;
    }

    setSavingPromptKey(key);
    setError('');

    try {
      const response = await authFetch(`/admin/dashboard/prompts/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminHeaders(),
        },
        body: JSON.stringify({
          name: draft.name,
          category: draft.category,
          content: draft.content,
          is_active: draft.is_active,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await loadAll();
      setSuccess(`提示词 ${key} 已保存。`);
    } catch (err) {
      setError((err as Error).message || '提示词保存失败。');
    } finally {
      setSavingPromptKey('');
    }
  }

  async function saveConfig() {
    setSavingConfig(true);
    setError('');

    const body: Record<string, string> = {
      openai_base_url: baseUrl.trim(),
      openai_model: chatModel.trim(),
      openai_embedding_model: embeddingModel.trim(),
      web_origin: webOrigin.trim(),
    };

    if (apiKey.trim()) {
      body.openai_api_key = apiKey.trim();
    } else if (clearApiKey) {
      body.openai_api_key = '';
    }

    try {
      const response = await authFetch('/admin/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminHeaders(),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as AdminConfig;
      applyConfig(payload);
      setApiKey('');
      setClearApiKey(false);
      setSuccess('系统配置已保存。');
    } catch (err) {
      setError((err as Error).message || '保存配置失败。');
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleLogout() {
    try {
      await logoutAdmin();
    } finally {
      window.location.replace('/admin/login');
    }
  }

  if (checking) {
    return <AppLoadingScreen label="正在进入后台..." />;
  }

  if (!session) {
    return null;
  }

  return (
    <AuthShell
      title="后台管理台"
      subtitle="用户、在线、AI消耗、提示词、系统配置与日志集中管理。"
    >
      <div className="space-y-4">
        <section className="mw-card-dark p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-white">管理员：{session.username}</p>
              <p className="mt-2 text-sm text-zinc-300">当前认证方式：{session.auth_mode}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadAll()}
                disabled={loading}
                className="h-10 rounded-xl border border-white/20 bg-white/10 px-4 text-sm text-white"
              >
                {loading ? '刷新中...' : '刷新全部'}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="h-10 rounded-xl border border-white/20 bg-white/10 px-4 text-sm text-white"
              >
                退出后台
              </button>
            </div>
          </div>
        </section>

        {overview ? (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="mw-card p-4">
              <p className="text-xs text-zinc-500">注册用户</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-900">{overview.registered_users}</p>
            </article>
            <article className="mw-card p-4">
              <p className="text-xs text-zinc-500">在线用户（10分钟）</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-900">{overview.online_users}</p>
            </article>
            <article className="mw-card p-4">
              <p className="text-xs text-zinc-500">累计 Token</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-900">{overview.ai_usage.total_tokens}</p>
            </article>
            <article className="mw-card p-4">
              <p className="text-xs text-zinc-500">预计花费（USD）</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-900">
                {overview.ai_usage.estimated_cost_usd.toFixed(4)}
              </p>
            </article>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <article className="mw-card p-5">
            <h3 className="text-lg font-semibold text-zinc-900">用户管理</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="px-2 py-2">用户名</th>
                    <th className="px-2 py-2">匿名名</th>
                    <th className="px-2 py-2">城市</th>
                    <th className="px-2 py-2">在线</th>
                    <th className="px-2 py-2">状态</th>
                    <th className="px-2 py-2">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {(users?.users || []).map((item) => (
                    <tr key={item.id} className="border-t border-zinc-100">
                      <td className="px-2 py-2 text-zinc-800">{item.username || '-'}</td>
                      <td className="px-2 py-2 text-zinc-700">{item.profile?.anonymous_name || '-'}</td>
                      <td className="px-2 py-2 text-zinc-700">{item.profile?.city || '-'}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${
                            item.online
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-zinc-100 text-zinc-600'
                          }`}
                        >
                          {item.online ? '在线' : '离线'}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={item.status}
                          disabled={updatingUserId === item.id}
                          onChange={(event) =>
                            void handleUpdateUserStatus(
                              item.id,
                              event.target.value as DashboardUser['status'],
                            )
                          }
                          className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-xs"
                        >
                          <option value="onboarding">onboarding</option>
                          <option value="active">active</option>
                          <option value="restricted">restricted</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => void loadUserDetail(item.id)}
                          className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-xs text-zinc-700"
                        >
                          查看
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="mw-card p-5">
            <h3 className="text-lg font-semibold text-zinc-900">在线用户</h3>
            {(online?.users || []).length === 0 ? (
              <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-600">暂无在线用户。</div>
            ) : (
              <div className="mt-3 space-y-2">
                {online?.users.map((item) => (
                  <div key={item.user_id} className="rounded-xl border border-zinc-100 bg-white p-3">
                    <p className="text-sm font-medium text-zinc-800">
                      {item.username || item.profile?.anonymous_name || item.user_id}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {item.profile?.city || '未设置城市'} · 最近在线 {new Date(item.last_seen_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <article className="mw-card p-5">
            <h3 className="text-lg font-semibold text-zinc-900">AI 生成记录</h3>
            <div className="mt-3 max-h-[420px] overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="px-2 py-2">时间</th>
                    <th className="px-2 py-2">功能</th>
                    <th className="px-2 py-2">模型</th>
                    <th className="px-2 py-2">Token</th>
                    <th className="px-2 py-2">费用(USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {(aiRecords?.records || []).map((item) => (
                    <tr key={item.id} className="border-t border-zinc-100">
                      <td className="px-2 py-2 text-zinc-600">{new Date(item.created_at).toLocaleString()}</td>
                      <td className="px-2 py-2 text-zinc-800">{item.feature}</td>
                      <td className="px-2 py-2 text-zinc-700">{item.model}</td>
                      <td className="px-2 py-2 text-zinc-700">{item.total_tokens}</td>
                      <td className="px-2 py-2 text-zinc-700">{item.estimated_cost_usd.toFixed(6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="mw-card p-5">
            <h3 className="text-lg font-semibold text-zinc-900">系统配置</h3>
            <div className="mt-4 grid gap-3">
              <label className="text-sm text-zinc-700">
                AI 接口地址
                <input
                  className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={defaultBaseUrl}
                />
              </label>
              <label className="text-sm text-zinc-700">
                聊天模型
                <input
                  className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm"
                  value={chatModel}
                  onChange={(event) => setChatModel(event.target.value)}
                  placeholder={defaultChatModel}
                />
              </label>
              <label className="text-sm text-zinc-700">
                Embedding 模型
                <input
                  className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm"
                  value={embeddingModel}
                  onChange={(event) => setEmbeddingModel(event.target.value)}
                  placeholder={defaultEmbeddingModel}
                />
              </label>
              <label className="text-sm text-zinc-700">
                前端来源地址
                <input
                  className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm"
                  value={webOrigin}
                  onChange={(event) => setWebOrigin(event.target.value)}
                  placeholder={defaultWebOrigin}
                />
              </label>
              <label className="text-sm text-zinc-700">
                API Key
                <input
                  className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="sk-..."
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  onChange={(event) => setClearApiKey(event.target.checked)}
                  disabled={apiKey.trim().length > 0}
                />
                清空已保存 API Key
              </label>
              <button
                type="button"
                onClick={saveConfig}
                disabled={savingConfig}
                className="h-10 rounded-xl bg-zinc-950 text-sm font-medium text-white disabled:bg-zinc-300"
              >
                {savingConfig ? '保存中...' : '保存配置'}
              </button>

              {config ? (
                <div className="rounded-xl bg-zinc-50 p-3 text-xs leading-6 text-zinc-600">
                  <p>Key 状态：{config.openai_api_key_configured ? `已配置（${config.openai_api_key_preview || '隐藏'}）` : '未配置'}</p>
                  <p>配置文件：{config.config_file}</p>
                  <p>更新时间：{config.updated_at || '未写入'}</p>
                </div>
              ) : null}
            </div>
          </article>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <article className="mw-card p-5">
            <h3 className="text-lg font-semibold text-zinc-900">提示词管理</h3>
            <div className="mt-3 space-y-3">
              {prompts.map((item) => {
                const draft = promptDraft[item.key] || item;
                return (
                  <div key={item.id} className="rounded-xl border border-zinc-100 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-zinc-900">{item.key}</p>
                      <span className="text-xs text-zinc-500">v{item.version}</span>
                    </div>
                    <input
                      className="mt-2 h-9 w-full rounded-lg border border-zinc-300 px-3 text-xs"
                      value={draft.name}
                      onChange={(event) =>
                        setPromptDraft((prev) => ({
                          ...prev,
                          [item.key]: {
                            ...draft,
                            name: event.target.value,
                          },
                        }))
                      }
                    />
                    <textarea
                      className="mt-2 min-h-28 w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs leading-6"
                      value={draft.content}
                      onChange={(event) =>
                        setPromptDraft((prev) => ({
                          ...prev,
                          [item.key]: {
                            ...draft,
                            content: event.target.value,
                          },
                        }))
                      }
                    />
                    <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={(event) =>
                          setPromptDraft((prev) => ({
                            ...prev,
                            [item.key]: {
                              ...draft,
                              is_active: event.target.checked,
                            },
                          }))
                        }
                      />
                      启用
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleSavePrompt(item.key)}
                      disabled={savingPromptKey === item.key}
                      className="mt-2 h-9 rounded-lg bg-zinc-950 px-3 text-xs font-medium text-white disabled:bg-zinc-300"
                    >
                      {savingPromptKey === item.key ? '保存中...' : '保存提示词'}
                    </button>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="mw-card p-5">
            <h3 className="text-lg font-semibold text-zinc-900">服务器日志</h3>
            <div className="mt-3 rounded-xl bg-zinc-950 p-3 text-xs text-zinc-200">
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap leading-6">
                {(logs?.lines || []).join('\n') || '暂无日志'}
              </pre>
            </div>
          </article>
        </section>

        {selectedUserId ? (
          <div className="mw-modal" role="dialog" aria-modal="true">
            <div className="mw-card h-[90vh] w-full max-w-6xl overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
                <div>
                  <p className="text-lg font-semibold text-zinc-900">用户详情时间线</p>
                  <p className="mt-1 text-xs text-zinc-500">用户 ID: {selectedUserId}</p>
                </div>
                <button
                  type="button"
                  onClick={closeUserDetail}
                  className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-700"
                >
                  关闭
                </button>
              </div>

              <div className="h-[calc(90vh-74px)] overflow-auto p-5">
                {loadingUserDetail ? (
                  <div className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">正在加载用户详情...</div>
                ) : !userDetail ? (
                  <div className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">没有可展示的数据。</div>
                ) : (
                  <div className="space-y-4">
                    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <article className="rounded-xl border border-zinc-100 bg-white p-3">
                        <p className="text-xs text-zinc-500">用户名</p>
                        <p className="mt-1 text-sm font-semibold text-zinc-900">
                          {userDetail.user.username || '-'}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          匿名名 {userDetail.profile?.anonymous_name || '-'}
                        </p>
                      </article>
                      <article className="rounded-xl border border-zinc-100 bg-white p-3">
                        <p className="text-xs text-zinc-500">用户状态</p>
                        <p className="mt-1 text-sm font-semibold text-zinc-900">{userDetail.user.status}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          在线 {userDetail.presence.online ? '是' : '否'}
                        </p>
                      </article>
                      <article className="rounded-xl border border-zinc-100 bg-white p-3">
                        <p className="text-xs text-zinc-500">消息统计</p>
                        <p className="mt-1 text-sm font-semibold text-zinc-900">
                          发送 {userDetail.stats.sent_messages}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          blocked {userDetail.stats.blocked_messages} / modified {userDetail.stats.modified_messages}
                        </p>
                      </article>
                      <article className="rounded-xl border border-zinc-100 bg-white p-3">
                        <p className="text-xs text-zinc-500">AI 消耗</p>
                        <p className="mt-1 text-sm font-semibold text-zinc-900">
                          Token {userDetail.stats.total_tokens}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          ${userDetail.stats.estimated_cost_usd.toFixed(6)}
                        </p>
                      </article>
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                      <article className="rounded-xl border border-zinc-100 bg-white p-4">
                        <p className="text-sm font-semibold text-zinc-900">公开标签</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {userDetail.tags.public.length === 0 ? (
                            <span className="text-xs text-zinc-500">暂无公开标签</span>
                          ) : (
                            userDetail.tags.public.map((tag) => (
                              <span
                                key={`public-${tag.tag_name}`}
                                className="rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] text-white"
                              >
                                {tag.tag_name}({tag.weight})
                              </span>
                            ))
                          )}
                        </div>
                      </article>

                      <article className="rounded-xl border border-zinc-100 bg-white p-4">
                        <p className="text-sm font-semibold text-zinc-900">隐藏标签（仅后台）</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {userDetail.tags.hidden.length === 0 ? (
                            <span className="text-xs text-zinc-500">暂无隐藏标签</span>
                          ) : (
                            userDetail.tags.hidden.map((tag) => (
                              <span
                                key={`hidden-${tag.tag_name}`}
                                className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] text-amber-800"
                              >
                                {tag.tag_name}({tag.weight})
                              </span>
                            ))
                          )}
                        </div>
                      </article>
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                      <article className="rounded-xl border border-zinc-100 bg-white p-4">
                        <p className="text-sm font-semibold text-zinc-900">最近匹配</p>
                        <div className="mt-2 max-h-60 space-y-2 overflow-auto">
                          {userDetail.recent.matches.length === 0 ? (
                            <p className="text-xs text-zinc-500">暂无匹配记录</p>
                          ) : (
                            userDetail.recent.matches.map((match) => (
                              <div key={match.id} className="rounded-lg border border-zinc-100 p-2 text-xs text-zinc-700">
                                <p className="font-medium text-zinc-900">
                                  {match.counterpart.anonymous_name || match.counterpart.username || match.counterpart.user_id}
                                </p>
                                <p className="mt-1">
                                  {match.status} · 共振 {match.resonance_score}
                                </p>
                                <p className="mt-1 text-zinc-500">{new Date(match.updated_at).toLocaleString()}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </article>

                      <article className="rounded-xl border border-zinc-100 bg-white p-4">
                        <p className="text-sm font-semibold text-zinc-900">最近消息</p>
                        <div className="mt-2 max-h-60 space-y-2 overflow-auto">
                          {userDetail.recent.messages.length === 0 ? (
                            <p className="text-xs text-zinc-500">暂无消息记录</p>
                          ) : (
                            userDetail.recent.messages.map((message) => (
                              <div key={message.id} className="rounded-lg border border-zinc-100 p-2 text-xs text-zinc-700">
                                <p className="font-medium text-zinc-900">{message.ai_action}</p>
                                <p className="mt-1 line-clamp-2">{message.ai_rewritten_text}</p>
                                <p className="mt-1 text-zinc-500">{new Date(message.created_at).toLocaleString()}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </article>
                    </section>

                    <section className="rounded-xl border border-zinc-100 bg-white p-4">
                      <p className="text-sm font-semibold text-zinc-900">事件时间线</p>
                      <div className="mt-2 max-h-[360px] space-y-2 overflow-auto">
                        {userDetail.timeline.length === 0 ? (
                          <p className="text-xs text-zinc-500">暂无事件。</p>
                        ) : (
                          userDetail.timeline.map((event, index) => (
                            <div key={`${event.ts}-${event.type}-${index}`} className="rounded-lg border border-zinc-100 p-2">
                              <p className="text-xs font-medium text-zinc-900">{event.title}</p>
                              <p className="mt-1 text-xs text-zinc-700">{event.detail}</p>
                              <p className="mt-1 text-[11px] text-zinc-500">
                                {event.type} · {new Date(event.ts).toLocaleString()}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </section>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {success ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    </AuthShell>
  );
}

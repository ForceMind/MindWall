"use client";

import { useEffect, useState } from 'react';
import { AppLoadingScreen, AuthShell } from '../../../components/app-shell';
import { apiBaseUrl } from '../../../lib/config';
import {
  clearStoredAdminToken,
  fetchAdminSession,
  storeAdminToken,
} from '../../../lib/admin-session';

function toFriendlyError(raw: string) {
  if (/Invalid admin username or password/i.test(raw)) {
    return '管理员账号或密码错误。';
  }
  if (/not configured/i.test(raw)) {
    return '服务器还没有配置后台管理员密码，请先在后端环境变量设置 ADMIN_PASSWORD。';
  }
  return raw || '后台登录失败。';
}

export default function AdminLoginPage() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function bootstrap() {
      try {
        const session = await fetchAdminSession();
        if (session) {
          window.location.replace('/admin');
          return;
        }
      } catch {
        // ignore
      } finally {
        setChecking(false);
      }
    }

    void bootstrap();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(`${apiBaseUrl}/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(toFriendlyError(detail));
      }

      const data = (await response.json()) as { session_token?: string };
      if (!data.session_token) {
        throw new Error('后台登录失败：后端没有返回会话令牌。');
      }

      storeAdminToken(data.session_token);
      window.location.replace('/admin');
    } catch (err) {
      clearStoredAdminToken();
      setError((err as Error).message || '后台登录失败。');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return <AppLoadingScreen label="正在检查后台登录状态..." />;
  }

  return (
    <AuthShell title="后台管理登录" subtitle="登录后可管理用户、模型配置、提示词、AI消耗与系统日志。">
      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="mw-card-dark p-6 md:p-7">
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Admin</p>
          <h2 className="mt-3 text-2xl font-semibold">MindWall 运营控制台</h2>
          <div className="mt-4 space-y-3 text-sm leading-7 text-zinc-300">
            <p>1. 查看注册用户与在线用户。</p>
            <p>2. 查看 AI 调用记录、Token 消耗与预计费用。</p>
            <p>3. 管理系统配置、提示词模板和服务器日志。</p>
          </div>
        </section>

        <section className="mw-card p-6 md:p-7">
          <h3 className="text-xl font-semibold text-zinc-900">管理员登录</h3>
          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <input
              className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950"
              placeholder="管理员账号"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950"
              placeholder="管理员密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="submit"
              disabled={submitting}
              className="h-12 w-full rounded-2xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {submitting ? '登录中...' : '进入后台'}
            </button>
          </form>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </section>
      </div>
    </AuthShell>
  );
}

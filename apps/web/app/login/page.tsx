"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppLoadingScreen, AuthShell } from '../../components/app-shell';
import { fetchCurrentViewer } from '../../lib/auth-client';
import { readApiError } from '../../lib/api-error';
import { apiBaseUrl } from '../../lib/config';
import { getStoredToken, storeToken } from '../../lib/session';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function bootstrap() {
      if (!getStoredToken()) {
        setChecking(false);
        return;
      }

      try {
        const viewer = await fetchCurrentViewer();
        if (viewer) {
          window.location.replace('/contacts');
          return;
        }
      } catch {
        // ignore
      }

      setChecking(false);
    }

    void bootstrap();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    if (!username.trim()) {
      setError('请输入用户名。');
      setSubmitting(false);
      return;
    }

    if (!password.trim()) {
      setError('请输入密码。');
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, '登录失败，请稍后再试。'));
      }

      const data = (await response.json()) as { session_token?: string };
      if (!data.session_token) {
        throw new Error('登录失败，请稍后再试。');
      }

      storeToken(data.session_token);
      window.location.replace('/contacts');
    } catch (err) {
      setError((err as Error).message || '登录失败。');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return <AppLoadingScreen label="正在检查登录状态..." />;
  }

  return (
    <AuthShell
      title="登录心垣"
      subtitle="匿名交友，不靠头像速配。先建立边界与理解，再决定是否靠近。"
    >
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="mw-card-dark p-6 md:p-7">
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Platform</p>
          <h2 className="mt-3 text-2xl font-semibold">MindWall（心垣）</h2>
          <p className="mt-4 text-sm leading-8 text-zinc-300">
            这里不是即时搭讪场。系统会先通过访谈生成匿名画像与标签，再进入城市内匹配。
            早期聊天会经过安全中间层，减少骚扰和冒犯。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-white/8 p-4">
              <p className="text-sm font-semibold text-white">匿名起步</p>
              <p className="mt-2 text-xs leading-6 text-zinc-300">先保护自己，再决定暴露多少真实信息。</p>
            </div>
            <div className="rounded-2xl bg-white/8 p-4">
              <p className="text-sm font-semibold text-white">AI 安全中介</p>
              <p className="mt-2 text-xs leading-6 text-zinc-300">早期消息先过滤，再转达，降低风险。</p>
            </div>
            <div className="rounded-2xl bg-white/8 p-4">
              <p className="text-sm font-semibold text-white">共鸣后破壁</p>
              <p className="mt-2 text-xs leading-6 text-zinc-300">共振分达到阈值，双方同意后再切换直连。</p>
            </div>
          </div>
        </section>

        <section className="mw-card p-6 md:p-7">
          <h3 className="text-xl font-semibold text-zinc-900">账号登录</h3>
          <p className="mt-2 text-sm leading-7 text-zinc-600">使用用户名和密码登录。</p>
          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <input
              className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950"
              placeholder="用户名"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950"
              placeholder="密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="submit"
              disabled={submitting}
              className="h-12 w-full rounded-2xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {submitting ? '登录中...' : '登录'}
            </button>
          </form>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <p className="mt-5 text-sm text-zinc-600">
            还没有账号？{' '}
            <Link href="/register" className="font-medium text-zinc-950 underline">
              去注册
            </Link>
          </p>
        </section>
      </div>
    </AuthShell>
  );
}

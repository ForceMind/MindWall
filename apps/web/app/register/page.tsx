"use client";

import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '../../components/app-shell';
import { readApiError } from '../../lib/api-error';
import { apiBaseUrl } from '../../lib/config';
import { storeToken } from '../../lib/session';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('请输入用户名。');
      return;
    }
    if (username.trim().length < 2 || username.trim().length > 24) {
      setError('用户名长度需要在 2 到 24 个字符之间。');
      return;
    }
    if (!password) {
      setError('请输入密码。');
      return;
    }
    if (password.length < 6) {
      setError('密码至少需要 6 位。');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致。');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/register`, {
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
        throw new Error(await readApiError(response, '注册失败，请稍后再试。'));
      }

      const data = (await response.json()) as { session_token?: string };
      if (!data.session_token) {
        throw new Error('注册失败，请稍后再试。');
      }

      storeToken(data.session_token);
      window.location.replace('/contacts');
    } catch (err) {
      setError((err as Error).message || '注册失败。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="创建账号"
      subtitle="注册后会进入匿名新手流程：性别、年龄、深度访谈、城市选择。完成后开始匹配与聊天。"
    >
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="mw-card-dark p-6 md:p-7">
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Start Here</p>
          <h2 className="mt-3 text-2xl font-semibold">先看见内在，再决定是否破壁</h2>
          <div className="mt-4 space-y-3 text-sm leading-7 text-zinc-300">
            <p>1. 注册只需要用户名和密码，不要求邮箱。</p>
            <p>2. 系统先引导完成匿名访谈与画像标签。</p>
            <p>3. 匹配后从沙盒聊天起步，共鸣到位再进入直连。</p>
          </div>
        </section>

        <section className="mw-card p-6 md:p-7">
          <h3 className="text-xl font-semibold text-zinc-900">快速注册</h3>
          <p className="mt-2 text-sm leading-7 text-zinc-600">用户名支持中文、字母、数字、下划线和短横线。</p>
          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <input
              className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950"
              placeholder="用户名"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950"
              placeholder="密码（至少 6 位）"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <input
              className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950"
              placeholder="确认密码"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            <button
              type="submit"
              disabled={submitting}
              className="h-12 w-full rounded-2xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {submitting ? '注册中...' : '注册并进入联系人'}
            </button>
          </form>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <p className="mt-5 text-sm text-zinc-600">
            已有账号？{' '}
            <Link href="/login" className="font-medium text-zinc-950 underline">
              去登录
            </Link>
          </p>
        </section>
      </div>
    </AuthShell>
  );
}

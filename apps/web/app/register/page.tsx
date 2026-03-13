"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "../../components/app-shell";
import { apiBaseUrl } from "../../lib/config";
import { storeToken } from "../../lib/session";

export default function RegisterPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          display_name: displayName,
          email,
          password,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`注册失败：${response.status} ${detail}`);
      }

      const data = (await response.json()) as { session_token?: string };
      if (!data.session_token) {
        throw new Error("注册失败：后端没有返回会话令牌。");
      }

      storeToken(data.session_token);
      window.location.replace("/");
    } catch (err) {
      setError((err as Error).message || "注册失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="注册"
      subtitle="先创建账号，再进入访谈、匹配和沙盒聊天。"
    >
      <section className="mw-card-dark p-5">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/6 px-4 text-sm outline-none placeholder:text-zinc-500 focus:border-[#9fe870]"
            placeholder="昵称，可选"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <input
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/6 px-4 text-sm outline-none placeholder:text-zinc-500 focus:border-[#9fe870]"
            placeholder="邮箱"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/6 px-4 text-sm outline-none placeholder:text-zinc-500 focus:border-[#9fe870]"
            placeholder="密码，至少 8 位"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <input
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/6 px-4 text-sm outline-none placeholder:text-zinc-500 focus:border-[#9fe870]"
            placeholder="确认密码"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <button
            type="submit"
            disabled={submitting}
            className="h-12 w-full rounded-2xl bg-[#9fe870] text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:bg-[#d8efc9]"
          >
            {submitting ? "注册中..." : "注册并进入"}
          </button>
        </form>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <p className="mt-5 text-sm text-zinc-300">
          已有账号？{" "}
          <Link href="/login" className="font-medium text-white underline">
            去登录
          </Link>
        </p>
      </section>
    </AuthShell>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppLoadingScreen, AuthShell } from "../../components/app-shell";
import { fetchCurrentViewer } from "../../lib/auth-client";
import { apiBaseUrl } from "../../lib/config";
import { getStoredToken, storeToken } from "../../lib/session";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function bootstrap() {
      if (!getStoredToken()) {
        setChecking(false);
        return;
      }

      try {
        const viewer = await fetchCurrentViewer();
        if (viewer) {
          window.location.replace("/");
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
    setError("");

    try {
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`登录失败：${response.status} ${detail}`);
      }

      const data = (await response.json()) as { session_token?: string };
      if (!data.session_token) {
        throw new Error("登录失败：后端没有返回会话令牌。");
      }

      storeToken(data.session_token);
      window.location.replace("/");
    } catch (err) {
      setError((err as Error).message || "登录失败。");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return <AppLoadingScreen label="正在检查登录状态..." />;
  }

  return (
    <AuthShell
      title="登录"
      subtitle="登录后进入你的 MindWall 私密社交空间。"
    >
      <section className="mw-card p-5">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input
            className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950"
            placeholder="邮箱"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
            {submitting ? "登录中..." : "登录"}
          </button>
        </form>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <p className="mt-5 text-sm text-zinc-600">
          还没有账号？{" "}
          <Link href="/register" className="font-medium text-zinc-950 underline">
            去注册
          </Link>
        </p>
      </section>
    </AuthShell>
  );
}

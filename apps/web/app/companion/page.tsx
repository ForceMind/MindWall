"use client";

import { useEffect, useRef, useState } from "react";
import { AppLoadingScreen, AppShell } from "../../components/app-shell";
import { fetchCurrentViewer, logout, type Viewer } from "../../lib/auth-client";
import { apiBaseUrl } from "../../lib/config";
import { getAuthHeaders } from "../../lib/session";

type CompanionMessage = {
  role: "assistant" | "user";
  text: string;
};

export default function CompanionPage() {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [checking, setChecking] = useState(true);
  const [messages, setMessages] = useState<CompanionMessage[]>([
    {
      role: "assistant",
      text: "这里是 AI 陪练模式。在没有真实匹配对象时，你可以先在这里练习表达和聊天节奏。",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function bootstrap() {
      try {
        const nextViewer = await fetchCurrentViewer();
        if (!nextViewer) {
          window.location.replace("/login");
          return;
        }

        setViewer(nextViewer);
      } catch (err) {
        setError((err as Error).message || "加载陪练模式失败。");
      } finally {
        setChecking(false);
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content) {
      return;
    }

    const nextHistory = [...messages, { role: "user" as const, text: content }];
    setMessages(nextHistory);
    setInput("");
    setSending(true);
    setError("");

    try {
      const response = await fetch(`${apiBaseUrl}/companion/respond`, {
        method: "POST",
        headers: getAuthHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          history: nextHistory.map((item) => ({
            role: item.role,
            text: item.text,
          })),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`陪练回复失败：${response.status} ${detail}`);
      }

      const data = (await response.json()) as { reply?: string };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.reply || "我先接住你的话。如果你愿意，我们可以继续往更具体的方向聊。",
        },
      ]);
    } catch (err) {
      setError((err as Error).message || "陪练回复失败。");
    } finally {
      setSending(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      window.location.replace("/login");
    }
  }

  if (checking) {
    return <AppLoadingScreen label="正在载入 AI 陪练..." />;
  }

  if (!viewer) {
    return null;
  }

  return (
    <AppShell
      title="AI 陪练"
      subtitle="这是明确标识的 AI 模式，用来在没有真实匹配时练习聊天表达。"
      actions={
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex h-10 items-center rounded-2xl border border-black/8 bg-white/80 px-4 text-sm text-zinc-700"
        >
          退出
        </button>
      }
      status={
        <>
          <span className="mw-chip">{viewer.profile?.real_name || viewer.user.email}</span>
          <span className="mw-chip">模式 AI 陪练</span>
          <span className="mw-chip">公开标识 已开启</span>
        </>
      }
    >
      <div className="space-y-4">
        <section className="mw-card-dark p-5">
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Practice</p>
          <h2 className="mt-2 text-xl font-semibold">低压力练习区</h2>
          <p className="mt-2 text-sm leading-7 text-zinc-300">
            这里不会伪装成真实用户，只提供节奏、表达和情绪接球练习。
          </p>
        </section>

        <section className="mw-card p-4">
          <div
            ref={listRef}
            className="max-h-[40svh] min-h-[280px] space-y-3 overflow-y-auto rounded-[22px] bg-zinc-50 p-3"
          >
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`rounded-2xl px-4 py-3 text-sm leading-7 ${
                  message.role === "assistant"
                    ? "mr-10 bg-white text-zinc-800 shadow-sm"
                    : "ml-10 bg-zinc-950 text-white"
                }`}
              >
                <p className="mb-1 text-xs opacity-60">
                  {message.role === "assistant" ? "AI 陪练" : "我"}
                </p>
                <p>{message.text}</p>
              </div>
            ))}
          </div>

          <form className="mt-4 space-y-3" onSubmit={handleSend}>
            <textarea
              className="min-h-28 w-full rounded-[22px] border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-zinc-950"
              placeholder="输入你想练习的表达..."
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <button
              type="submit"
              disabled={sending}
              className="h-11 w-full rounded-2xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {sending ? "生成中..." : "发送"}
            </button>
          </form>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

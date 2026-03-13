"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppLoadingScreen, AppShell } from "../components/app-shell";
import { fetchCurrentViewer, logout, type Viewer } from "../lib/auth-client";
import { apiBaseUrl } from "../lib/config";
import { getAuthHeaders } from "../lib/session";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
};

function statusText(isCompleted: boolean, sessionId: string) {
  if (isCompleted) {
    return "已完成";
  }
  if (sessionId) {
    return "进行中";
  }
  return "未开始";
}

export default function HomePage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionId, setSessionId] = useState("");
  const [city, setCity] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [summary, setSummary] = useState("");
  const [isCompleted, setIsCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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
        setCity(nextViewer.profile?.city || "");
        setIsCompleted(
          nextViewer.user.status === "active" && nextViewer.public_tags.length > 0,
        );
      } catch (err) {
        setError((err as Error).message || "加载账户信息失败。");
      } finally {
        setChecking(false);
      }
    }

    void bootstrap();
  }, []);

  async function handleLogout() {
    try {
      await logout();
    } finally {
      window.location.replace("/login");
    }
  }

  async function startInterview() {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`${apiBaseUrl}/onboarding/me/session`, {
        method: "POST",
        headers: getAuthHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          city: city.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`启动访谈失败：${response.status} ${detail}`);
      }

      const data = (await response.json()) as {
        session_id: string;
        assistant_message: string;
      };

      setSessionId(data.session_id);
      setMessages([{ role: "assistant", text: data.assistant_message }]);
      setSummary("");
      setIsCompleted(false);
    } catch (err) {
      setError((err as Error).message || "启动访谈失败。");
    } finally {
      setIsLoading(false);
    }
  }

  async function sendAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || !sessionId) {
      return;
    }

    setInput("");
    setIsLoading(true);
    setError("");
    setMessages((prev) => [...prev, { role: "user", text: content }]);

    try {
      const response = await fetch(
        `${apiBaseUrl}/onboarding/me/session/${sessionId}/messages`,
        {
          method: "POST",
          headers: getAuthHeaders({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            message: content,
          }),
        },
      );

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`发送失败：${response.status} ${detail}`);
      }

      const data = (await response.json()) as {
        status: string;
        assistant_message?: string;
        onboarding_summary?: string;
      };

      if (data.status === "completed") {
        const nextViewer = await fetchCurrentViewer();
        setViewer(nextViewer);
        setIsCompleted(true);
        setSummary(data.onboarding_summary || "");
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: "访谈完成。你的公开标签已经生成，可以进入匹配。",
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.assistant_message || "请继续回答。",
        },
      ]);
    } catch (err) {
      setError((err as Error).message || "发送失败。");
    } finally {
      setIsLoading(false);
    }
  }

  if (checking) {
    return <AppLoadingScreen label="正在载入你的访谈空间..." />;
  }

  if (!viewer) {
    return null;
  }

  return (
    <AppShell
      title="灵魂访谈"
      subtitle="先回答 4 个问题，系统会生成你的公开标签和匹配画像。"
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
          <span className="mw-chip">城市 {city || "未填写"}</span>
          <span className="mw-chip">状态 {statusText(isCompleted, sessionId)}</span>
        </>
      }
    >
      <div className="space-y-4">
        <section className="mw-card-dark p-5">
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Step 1</p>
          <h2 className="mt-2 text-xl font-semibold">开始访谈</h2>
          <p className="mt-2 text-sm leading-7 text-zinc-300">
            先填写你想匹配的城市，再启动访谈。每次发送一段完整回答即可。
          </p>

          <div className="mt-4 space-y-3">
            <input
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/6 px-4 text-sm outline-none placeholder:text-zinc-500 focus:border-[#9fe870]"
              placeholder="城市，例如 上海"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
            <button
              type="button"
              onClick={startInterview}
              disabled={isLoading}
              className="h-12 w-full rounded-2xl bg-[#9fe870] px-5 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:bg-[#d8efc9]"
            >
              {isLoading ? "处理中..." : sessionId ? "重新开始访谈" : "开始访谈"}
            </button>
          </div>
        </section>

        <section className="mw-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-900">访谈对话</p>
              <p className="mt-1 text-xs text-zinc-500">
                {messages.length === 0 ? "开始后会在这里连续提问" : "对话会自动保存在当前会话中"}
              </p>
            </div>
            <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-white">
              {statusText(isCompleted, sessionId)}
            </span>
          </div>

          <div className="mt-4 max-h-[34svh] min-h-[220px] space-y-3 overflow-y-auto rounded-[22px] bg-zinc-50 p-3">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-4 text-sm leading-7 text-zinc-500">
                点击“开始访谈”后，系统会先问你第一个问题。
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`rounded-2xl px-4 py-3 text-sm leading-7 ${
                    message.role === "assistant"
                      ? "mr-10 bg-white text-zinc-800 shadow-sm"
                      : "ml-10 bg-zinc-950 text-white"
                  }`}
                >
                  <p className="mb-1 text-xs opacity-60">
                    {message.role === "assistant" ? "访谈助手" : "我"}
                  </p>
                  <p>{message.text}</p>
                </div>
              ))
            )}
          </div>

          <form className="mt-4 space-y-3" onSubmit={sendAnswer}>
            <textarea
              className="min-h-28 w-full rounded-[22px] border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-zinc-950"
              placeholder="输入你的回答..."
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={!sessionId || isCompleted}
            />
            <button
              type="submit"
              disabled={!sessionId || !input.trim() || isLoading || isCompleted}
              className="h-11 w-full rounded-2xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              发送回答
            </button>
          </form>
        </section>

        <section className="mw-card p-4">
          <p className="text-sm font-semibold text-zinc-900">公开标签</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {viewer.public_tags.length === 0 ? (
              <span className="rounded-full bg-zinc-100 px-3 py-2 text-xs text-zinc-500">
                完成访谈后生成
              </span>
            ) : (
              viewer.public_tags.map((tag) => (
                <span
                  key={tag.tag_name}
                  className="rounded-full bg-zinc-950 px-3 py-2 text-xs font-medium text-white"
                >
                  {tag.tag_name}
                </span>
              ))
            )}
          </div>
          <p className="mt-4 text-sm leading-7 text-zinc-600">
            {summary || "完成访谈后，你就可以进入盲盒匹配。"}
          </p>
        </section>

        <section className="mw-card p-4">
          <p className="text-sm font-semibold text-zinc-900">下一步</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Link
              href="/matches"
              className="flex h-12 items-center justify-center rounded-2xl bg-zinc-950 text-sm font-medium text-white"
            >
              去匹配
            </Link>
            <Link
              href="/companion"
              className="flex h-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-700"
            >
              AI 陪练
            </Link>
          </div>
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

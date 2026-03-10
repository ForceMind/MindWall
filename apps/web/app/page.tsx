"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
};

type PublicTag = {
  tag_name: string;
  weight: number;
  ai_justification: string;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3000";
const userIdStorageKey = "mindwall_user_id";
const cityStorageKey = "mindwall_city";

export default function HomePage() {
  const [nickname, setNickname] = useState("");
  const [city, setCity] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [userId, setUserId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [summary, setSummary] = useState("");
  const [publicTags, setPublicTags] = useState<PublicTag[]>([]);
  const [error, setError] = useState("");

  const canSend = useMemo(() => {
    return Boolean(sessionId) && input.trim().length > 0 && !isLoading && !isCompleted;
  }, [sessionId, input, isLoading, isCompleted]);

  const matchLink = useMemo(() => {
    const query = new URLSearchParams();
    if (userId) {
      query.set("user_id", userId);
    }
    if (city.trim()) {
      query.set("city", city.trim());
    }
    const suffix = query.toString();
    return suffix ? `/matches?${suffix}` : "/matches";
  }, [city, userId]);

  async function startInterview() {
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/onboarding/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_provider_id: nickname.trim() || undefined,
          city: city.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`启动访谈失败：${response.status}`);
      }

      const data = await response.json();
      const nextUserId = String(data.user_id || "");

      setSessionId(String(data.session_id || ""));
      setUserId(nextUserId);
      setMessages([{ role: "assistant", text: String(data.assistant_message || "") }]);
      setSummary("");
      setPublicTags([]);
      setIsCompleted(false);

      if (nextUserId) {
        window.localStorage.setItem(userIdStorageKey, nextUserId);
      }
      if (city.trim()) {
        window.localStorage.setItem(cityStorageKey, city.trim());
      }
    } catch (err) {
      setError((err as Error).message || "启动访谈失败");
    } finally {
      setIsLoading(false);
    }
  }

  async function sendAnswer(event: FormEvent) {
    event.preventDefault();
    if (!canSend) {
      return;
    }

    const answer = input.trim();
    setInput("");
    setError("");
    setIsLoading(true);
    setMessages((prev) => [...prev, { role: "user", text: answer }]);

    try {
      const response = await fetch(
        `${apiBaseUrl}/onboarding/sessions/${sessionId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: answer }),
        },
      );

      if (!response.ok) {
        throw new Error(`发送失败：${response.status}`);
      }

      const data = await response.json();

      if (data.status === "completed") {
        setIsCompleted(true);
        setSummary(String(data.onboarding_summary || ""));
        setPublicTags(Array.isArray(data.public_tags) ? data.public_tags : []);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: "访谈完成。已生成你的公开标签，可以进入匹配。",
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: String(data.assistant_message || "请继续回答。") },
      ]);
    } catch (err) {
      setError((err as Error).message || "发送失败");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans">
      <main className="mx-auto w-full max-w-6xl space-y-6">
        <header className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.25em] text-zinc-500">
                MINDWALL | 心垣
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-zinc-900 md:text-3xl">
                新用户入口
              </h1>
              <p className="mt-2 text-sm leading-7 text-zinc-600">
                第一步先完成 4 轮 AI 访谈，系统会生成你的公开标签，再进入盲盒匹配。
              </p>
            </div>
            <Link
              href="/admin"
              className="inline-flex h-10 items-center rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700"
            >
              管理后台
            </Link>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
            <h2 className="text-sm font-semibold text-zinc-900">开始访谈</h2>
            <div className="mt-4 grid gap-3 rounded-2xl bg-zinc-100 p-4 md:grid-cols-[1fr_1fr_auto]">
              <input
                className="h-11 rounded-xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-500"
                placeholder="昵称（可选）"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                disabled={Boolean(sessionId)}
              />
              <input
                className="h-11 rounded-xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-500"
                placeholder="城市（用于同城匹配）"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                disabled={Boolean(sessionId)}
              />
              <button
                type="button"
                onClick={startInterview}
                disabled={isLoading || Boolean(sessionId)}
                className="h-11 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {sessionId ? "访谈已开始" : "开始访谈"}
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <h3 className="text-sm font-semibold text-zinc-800">对话区</h3>
              <div className="mt-3 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                {messages.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    点击“开始访谈”后，AI 会先提出第一个问题。
                  </p>
                ) : (
                  messages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`rounded-xl px-4 py-3 text-sm leading-7 ${
                        message.role === "assistant"
                          ? "bg-white text-zinc-800"
                          : "ml-8 bg-zinc-900 text-zinc-100"
                      }`}
                    >
                      <p className="mb-1 text-xs opacity-60">
                        {message.role === "assistant" ? "AI" : "我"}
                      </p>
                      <p>{message.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <form onSubmit={sendAnswer} className="mt-4 space-y-2">
              <textarea
                className="min-h-24 w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-zinc-500 disabled:bg-zinc-100"
                placeholder="输入你的回答..."
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={!sessionId || isCompleted}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-500">
                  {isCompleted ? "访谈已完成" : "每次发送一个完整回答"}
                </p>
                <button
                  type="submit"
                  disabled={!canSend}
                  className="h-10 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
                >
                  {isLoading ? "处理中..." : "发送"}
                </button>
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </form>
          </div>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-zinc-900">我的状态</h3>
              <div className="mt-3 space-y-1 text-sm text-zinc-700">
                <p>用户 ID：{userId || "未生成"}</p>
                <p>城市：{city || "未填写"}</p>
                <p>阶段：{isCompleted ? "访谈完成" : sessionId ? "访谈中" : "未开始"}</p>
              </div>
            </section>

            <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-zinc-900">公开标签</h3>
              <div className="mt-3 space-y-3">
                {publicTags.length === 0 ? (
                  <p className="text-sm text-zinc-500">完成访谈后显示。</p>
                ) : (
                  publicTags.map((tag) => (
                    <div key={tag.tag_name} className="rounded-xl bg-zinc-100 p-3">
                      <p className="text-sm font-semibold text-zinc-900">
                        {tag.tag_name}
                        <span className="ml-2 text-xs font-normal text-zinc-600">
                          权重 {tag.weight.toFixed(2)}
                        </span>
                      </p>
                      <p className="mt-1 text-xs leading-6 text-zinc-600">
                        {tag.ai_justification}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-zinc-900">访谈总结</h3>
              <p className="mt-2 text-sm leading-7 text-zinc-600">
                {summary || "完成访谈后显示一段总结。"}
              </p>
              <Link
                href={matchLink}
                className="mt-4 inline-flex h-10 items-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white"
              >
                进入盲盒匹配
              </Link>
            </section>
          </aside>
        </section>
      </main>
    </div>
  );
}

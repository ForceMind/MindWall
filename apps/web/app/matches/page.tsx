"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PublicTag = {
  tag_name: string;
  weight: number;
  ai_justification: string;
};

type MatchItem = {
  match_id: string;
  status: string;
  resonance_score: number;
  ai_match_reason: string;
  counterpart: {
    user_id: string;
    city: string | null;
    public_tags: PublicTag[];
  };
};

type RunSummary = {
  city_scope: string;
  considered_users: number;
  candidate_pairs: number;
  created_matches: number;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3000";
const userIdStorageKey = "mindwall_user_id";
const cityStorageKey = "mindwall_city";

export default function MatchesPage() {
  const [userId, setUserId] = useState("");
  const [city, setCity] = useState("");
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const userFromQuery = search.get("user_id")?.trim() || "";
    const cityFromQuery = search.get("city")?.trim() || "";
    const userFromStorage = window.localStorage.getItem(userIdStorageKey) || "";
    const cityFromStorage = window.localStorage.getItem(cityStorageKey) || "";

    const nextUserId = userFromQuery || userFromStorage;
    const nextCity = cityFromQuery || cityFromStorage;

    if (nextUserId) {
      setUserId(nextUserId);
      window.localStorage.setItem(userIdStorageKey, nextUserId);
    }
    if (nextCity) {
      setCity(nextCity);
      window.localStorage.setItem(cityStorageKey, nextCity);
    }
  }, []);

  const canRun = useMemo(() => !isRunning, [isRunning]);

  async function runMatchEngine() {
    setError("");
    setIsRunning(true);

    try {
      const response = await fetch(`${apiBaseUrl}/match-engine/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: city.trim() || undefined,
          max_matches_per_user: 3,
          min_score: 55,
          dry_run: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`运行匹配失败：${response.status}`);
      }

      const data = await response.json();
      setSummary({
        city_scope: String(data.city_scope || "ALL"),
        considered_users: Number(data.considered_users || 0),
        candidate_pairs: Number(data.candidate_pairs || 0),
        created_matches: Number(data.created_matches || 0),
      });

      if (userId.trim()) {
        await loadMatches(userId.trim());
      }

      if (city.trim()) {
        window.localStorage.setItem(cityStorageKey, city.trim());
      }
    } catch (err) {
      setError((err as Error).message || "运行匹配失败");
    } finally {
      setIsRunning(false);
    }
  }

  async function loadMatches(targetUserId?: string) {
    const normalizedUserId = (targetUserId || userId).trim();
    if (!normalizedUserId) {
      setError("请先填写用户 ID。");
      return;
    }

    setError("");
    setIsLoadingMatches(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/match-engine/users/${normalizedUserId}/matches`,
      );
      if (!response.ok) {
        throw new Error(`获取匹配列表失败：${response.status}`);
      }

      const data = await response.json();
      setMatches(Array.isArray(data.matches) ? data.matches : []);
      window.localStorage.setItem(userIdStorageKey, normalizedUserId);
    } catch (err) {
      setError((err as Error).message || "获取匹配列表失败");
    } finally {
      setIsLoadingMatches(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans">
      <main className="mx-auto w-full max-w-6xl space-y-6">
        <header className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
          <p className="text-xs font-semibold tracking-[0.25em] text-zinc-500">
            MINDWALL | 盲盒匹配
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900 md:text-3xl">
            今日匹配
          </h1>
          <p className="mt-2 text-sm leading-7 text-zinc-600">
            先运行匹配，再查看你的候选对象。页面只展示公开标签和匹配理由，不展示真实身份信息。
          </p>
          <div className="mt-4 flex gap-2">
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700"
            >
              返回首页
            </Link>
            <Link
              href="/sandbox"
              className="inline-flex h-10 items-center rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700"
            >
              打开聊天页
            </Link>
          </div>
        </header>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">操作区</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
            <input
              className="h-11 rounded-xl border border-zinc-300 px-4 text-sm outline-none focus:border-zinc-500"
              placeholder="我的用户 ID"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
            <input
              className="h-11 rounded-xl border border-zinc-300 px-4 text-sm outline-none focus:border-zinc-500"
              placeholder="城市（可选）"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
            <button
              type="button"
              className="h-11 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
              onClick={runMatchEngine}
              disabled={!canRun}
            >
              {isRunning ? "匹配中..." : "运行匹配"}
            </button>
            <button
              type="button"
              className="h-11 rounded-xl border border-zinc-300 px-5 text-sm font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => loadMatches()}
              disabled={isLoadingMatches}
            >
              {isLoadingMatches ? "读取中..." : "刷新列表"}
            </button>
          </div>

          {summary ? (
            <div className="mt-4 rounded-2xl bg-zinc-100 p-4 text-sm text-zinc-700">
              <p>城市范围：{summary.city_scope}</p>
              <p>参与用户：{summary.considered_users}</p>
              <p>候选配对：{summary.candidate_pairs}</p>
              <p>生成匹配：{summary.created_matches}</p>
            </div>
          ) : null}

          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-700">匹配结果</h2>
          {matches.length === 0 ? (
            <div className="rounded-3xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500 shadow-sm">
              暂无匹配。先点击“运行匹配”，再点击“刷新列表”。
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {matches.map((item) => (
                <article
                  key={item.match_id}
                  className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-zinc-900">
                      共振分：{item.resonance_score}
                    </p>
                    <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    对方城市：{item.counterpart.city || "未填写"}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-zinc-700">
                    {item.ai_match_reason}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.counterpart.public_tags.slice(0, 6).map((tag) => (
                      <span
                        key={`${item.match_id}-${tag.tag_name}`}
                        className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-zinc-100"
                      >
                        {tag.tag_name}
                      </span>
                    ))}
                  </div>
                  <Link
                    href={`/sandbox?user_id=${encodeURIComponent(
                      userId.trim(),
                    )}&match_id=${encodeURIComponent(item.match_id)}`}
                    className="mt-4 inline-flex h-10 items-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white"
                  >
                    进入沙盒聊天
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

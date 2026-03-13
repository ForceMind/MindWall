"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppLoadingScreen, AppShell } from "../../components/app-shell";
import { fetchCurrentViewer, logout, type Viewer } from "../../lib/auth-client";
import { apiBaseUrl } from "../../lib/config";
import { getAuthHeaders } from "../../lib/session";

type MatchItem = {
  match_id: string;
  status: string;
  resonance_score: number;
  ai_match_reason: string;
  counterpart: {
    city: string | null;
    public_tags: Array<{
      tag_name: string;
      weight: number;
      ai_justification: string;
    }>;
  };
};

type RunSummary = {
  city_scope: string;
  considered_users: number;
  candidate_pairs: number;
  created_matches: number;
};

export default function MatchesPage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [city, setCity] = useState("");
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
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
        await loadMatchesInternal();
      } catch (err) {
        setError((err as Error).message || "加载匹配页失败。");
      } finally {
        setChecking(false);
      }
    }

    void bootstrap();
  }, []);

  async function loadMatchesInternal() {
    setLoadingMatches(true);
    try {
      const response = await fetch(`${apiBaseUrl}/match-engine/me/matches`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`读取匹配失败：${response.status} ${detail}`);
      }

      const data = (await response.json()) as { matches?: MatchItem[] };
      setMatches(Array.isArray(data.matches) ? data.matches : []);
    } catch (err) {
      setError((err as Error).message || "读取匹配失败。");
    } finally {
      setLoadingMatches(false);
    }
  }

  async function runMatchEngine() {
    setRunning(true);
    setError("");

    try {
      const response = await fetch(`${apiBaseUrl}/match-engine/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          city: city.trim() || undefined,
          max_matches_per_user: 3,
          min_score: 55,
          dry_run: false,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`运行匹配失败：${response.status} ${detail}`);
      }

      const data = (await response.json()) as RunSummary;
      setSummary(data);
      await loadMatchesInternal();
    } catch (err) {
      setError((err as Error).message || "运行匹配失败。");
    } finally {
      setRunning(false);
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
    return <AppLoadingScreen label="正在整理你的盲盒匹配..." />;
  }

  if (!viewer) {
    return null;
  }

  return (
    <AppShell
      title="盲盒匹配"
      subtitle="只显示公开标签和匹配理由，不显示真实头像与身份。"
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
          <span className="mw-chip">结果 {matches.length} 个</span>
        </>
      }
    >
      <div className="space-y-4">
        <section className="mw-card-dark p-5">
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Step 2</p>
          <h2 className="mt-2 text-xl font-semibold">运行匹配</h2>
          <p className="mt-2 text-sm leading-7 text-zinc-300">
            先选择匹配城市，再刷新结果列表。结果卡片是匿名盲盒，不显示真实资料。
          </p>
          <div className="mt-4 space-y-3">
            <input
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/6 px-4 text-sm outline-none placeholder:text-zinc-500 focus:border-[#9fe870]"
              placeholder="城市，例如 上海"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={runMatchEngine}
                disabled={running}
                className="h-12 rounded-2xl bg-[#9fe870] text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:bg-[#d8efc9]"
              >
                {running ? "匹配中..." : "运行匹配"}
              </button>
              <button
                type="button"
                onClick={() => void loadMatchesInternal()}
                disabled={loadingMatches}
                className="h-12 rounded-2xl border border-white/10 bg-white/6 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingMatches ? "刷新中..." : "刷新结果"}
              </button>
            </div>
          </div>
        </section>

        {summary ? (
          <section className="mw-card p-4">
            <p className="text-sm font-semibold text-zinc-900">本轮匹配摘要</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-zinc-700">
              <div className="rounded-2xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-500">城市范围</p>
                <p className="mt-1 font-medium">{summary.city_scope}</p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-500">参与用户</p>
                <p className="mt-1 font-medium">{summary.considered_users}</p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-500">候选配对</p>
                <p className="mt-1 font-medium">{summary.candidate_pairs}</p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-500">生成匹配</p>
                <p className="mt-1 font-medium">{summary.created_matches}</p>
              </div>
            </div>
          </section>
        ) : null}

        {matches.length === 0 ? (
          <section className="mw-card p-5">
            <p className="text-base font-semibold text-zinc-900">还没有真实匹配</p>
            <p className="mt-2 text-sm leading-7 text-zinc-600">
              你可以先重新运行匹配，或者进入明确标识的 AI 陪练模式练习表达。
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Link
                href="/companion"
                className="flex h-12 items-center justify-center rounded-2xl bg-zinc-950 text-sm font-medium text-white"
              >
                AI 陪练
              </Link>
              <Link
                href="/"
                className="flex h-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-700"
              >
                回到访谈
              </Link>
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            {matches.map((item) => (
              <article key={item.match_id} className="mw-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">
                      共振分 {item.resonance_score}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      城市 {item.counterpart.city || "未填写"}
                    </p>
                  </div>
                  <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-white">
                    {item.status}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-7 text-zinc-700">
                  {item.ai_match_reason}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.counterpart.public_tags.map((tag) => (
                    <span
                      key={`${item.match_id}-${tag.tag_name}`}
                      className="rounded-full bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-700"
                    >
                      {tag.tag_name}
                    </span>
                  ))}
                </div>
                <Link
                  href={`/sandbox?match_id=${encodeURIComponent(item.match_id)}`}
                  className="mt-4 flex h-11 items-center justify-center rounded-2xl bg-zinc-950 text-sm font-medium text-white"
                >
                  进入沙盒聊天
                </Link>
              </article>
            ))}
          </section>
        )}

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

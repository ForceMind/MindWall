"use client";

import { useEffect, useRef, useState } from "react";
import { AppLoadingScreen, AppShell } from "../../components/app-shell";
import { fetchCurrentViewer, logout, type Viewer } from "../../lib/auth-client";
import { wsBaseUrl } from "../../lib/config";

type ChatLog = {
  id: string;
  role: "system" | "mine" | "peer";
  text: string;
  ts: string;
};

type UserProfileBrief = {
  userId: string;
  realName: string | null;
  realAvatar: string | null;
};

type WsMessage = {
  type?: string;
  message?: string;
  [key: string]: unknown;
};

function toProfile(input: unknown): UserProfileBrief | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const item = input as Record<string, unknown>;
  const userId = String(item.userId || "");
  if (!userId) {
    return null;
  }

  return {
    userId,
    realName: typeof item.realName === "string" ? item.realName : null,
    realAvatar: typeof item.realAvatar === "string" ? item.realAvatar : null,
  };
}

export default function SandboxPage() {
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [checking, setChecking] = useState(true);
  const [matchId, setMatchId] = useState("");
  const [text, setText] = useState("");
  const [logs, setLogs] = useState<ChatLog[]>([]);
  const [connected, setConnected] = useState(false);
  const [resonanceScore, setResonanceScore] = useState<number | null>(null);
  const [wallReady, setWallReady] = useState(false);
  const [wallBroken, setWallBroken] = useState(false);
  const [requesterAccepted, setRequesterAccepted] = useState(false);
  const [counterpartAccepted, setCounterpartAccepted] = useState(false);
  const [selfProfile, setSelfProfile] = useState<UserProfileBrief | null>(null);
  const [counterpartProfile, setCounterpartProfile] =
    useState<UserProfileBrief | null>(null);
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
        const search = new URLSearchParams(window.location.search);
        const fromQueryMatchId = search.get("match_id")?.trim() || "";
        if (fromQueryMatchId) {
          setMatchId(fromQueryMatchId);
        }
      } catch (err) {
        setError((err as Error).message || "加载聊天页失败。");
      } finally {
        setChecking(false);
      }
    }

    void bootstrap();

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs]);

  function appendLog(role: ChatLog["role"], message: string) {
    setLogs((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role,
        text: message,
        ts: new Date().toLocaleTimeString(),
      },
    ]);
  }

  function sendJson(payload: Record<string, unknown>) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("请先连接聊天服务。");
      return;
    }
    wsRef.current.send(JSON.stringify(payload));
  }

  function connectAndJoin() {
    if (!viewer) {
      return;
    }
    if (!matchId.trim()) {
      setError("请先填写 Match ID。");
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendJson({
        type: "auth",
        user_id: viewer.user.id,
      });
      sendJson({
        type: "join_match",
        match_id: matchId.trim(),
      });
      return;
    }

    const socket = new WebSocket(`${wsBaseUrl}/ws/sandbox`);
    wsRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      appendLog("system", "已连接聊天服务。");
      socket.send(
        JSON.stringify({
          type: "auth",
          user_id: viewer.user.id,
        }),
      );
      socket.send(
        JSON.stringify({
          type: "join_match",
          match_id: matchId.trim(),
        }),
      );
    };

    socket.onmessage = (event) => {
      let payload: WsMessage = {};
      try {
        payload = JSON.parse(String(event.data || "{}"));
      } catch {
        appendLog("system", "收到无法解析的消息。");
        return;
      }

      if (payload.type === "auth_ok") {
        appendLog("system", "身份验证成功。");
        return;
      }

      if (payload.type === "join_ok") {
        setLogs([]);
        setResonanceScore(Number(payload.resonance_score || 0));
        setWallReady(Boolean(payload.wall_ready));
        setWallBroken(Boolean(payload.wall_broken));
        setRequesterAccepted(Boolean(payload.requester_accepted));
        setCounterpartAccepted(Boolean(payload.counterpart_accepted));
        setSelfProfile(toProfile(payload.self_profile));
        setCounterpartProfile(toProfile(payload.counterpart_profile));
        appendLog("system", "已进入当前聊天。");
        socket.send(
          JSON.stringify({
            type: "fetch_history",
            match_id: matchId.trim(),
            limit: 50,
          }),
        );
        return;
      }

      if (payload.type === "history") {
        const rows = Array.isArray(payload.messages) ? payload.messages : [];
        for (const row of rows) {
          const item = row as Record<string, unknown>;
          const senderId = String(item.sender_id || "");
          const rewritten = String(item.ai_rewritten_text || "");
          appendLog(senderId === viewer.user.id ? "mine" : "peer", rewritten);
        }
        return;
      }

      if (payload.type === "sandbox_message" || payload.type === "direct_message") {
        appendLog("peer", String(payload.text || ""));
        return;
      }

      if (payload.type === "message_delivered") {
        appendLog("mine", String(payload.text || ""));
        return;
      }

      if (payload.type === "message_blocked") {
        appendLog("system", `消息被拦截：${String(payload.reason || "触发安全规则")}`);
        return;
      }

      if (payload.type === "resonance_update") {
        setResonanceScore(Number(payload.resonance_score || 0));
        return;
      }

      if (payload.type === "wall_ready") {
        setWallReady(true);
        appendLog("system", "共振分已达到 100，双方都可以发起破壁。");
        return;
      }

      if (payload.type === "wall_state" || payload.type === "wall_break_update") {
        setWallReady(Boolean(payload.wall_ready));
        setWallBroken(Boolean(payload.wall_broken));
        setRequesterAccepted(Boolean(payload.requester_accepted));
        setCounterpartAccepted(Boolean(payload.counterpart_accepted));
        setSelfProfile(toProfile(payload.self_profile));
        setCounterpartProfile(toProfile(payload.counterpart_profile));
        appendLog("system", "破壁状态已更新。");
        return;
      }

      if (payload.type === "wall_broken") {
        setWallReady(true);
        setWallBroken(true);
        setRequesterAccepted(Boolean(payload.requester_accepted));
        setCounterpartAccepted(Boolean(payload.counterpart_accepted));
        setSelfProfile(toProfile(payload.self_profile));
        setCounterpartProfile(toProfile(payload.counterpart_profile));
        appendLog("system", "双方已同意破壁，已切换为直连聊天。");
        return;
      }

      if (payload.type === "error") {
        const detail = String(payload.message || "未知错误");
        setError(detail);
        appendLog("system", `错误：${detail}`);
      }
    };

    socket.onerror = () => {
      setError("聊天连接异常。");
    };

    socket.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      appendLog("system", "连接已断开。");
    };
  }

  function disconnect() {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }

  function requestWallState() {
    sendJson({
      type: "wall_state",
      match_id: matchId.trim(),
    });
  }

  function sendWallDecision(accept: boolean) {
    sendJson({
      type: "wall_break_decision",
      match_id: matchId.trim(),
      accept,
    });
  }

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = text.trim();
    if (!content) {
      setError("消息不能为空。");
      return;
    }

    sendJson({
      type: wallBroken ? "direct_message" : "sandbox_message",
      match_id: matchId.trim(),
      text: content,
    });
    setText("");
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      window.location.replace("/login");
    }
  }

  if (checking) {
    return <AppLoadingScreen label="正在载入聊天空间..." />;
  }

  if (!viewer) {
    return null;
  }

  return (
    <AppShell
      title="沙盒聊天"
      subtitle="破壁前消息先经 AI 安全中间层；破壁后自动切换为直连聊天。"
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
          <span className="mw-chip">连接 {connected ? "已连接" : "未连接"}</span>
          <span className="mw-chip">共振 {resonanceScore ?? "-"}</span>
          <span className="mw-chip">{wallBroken ? "直连模式" : "沙盒模式"}</span>
        </>
      }
    >
      <div className="space-y-4">
        <section className="mw-card-dark p-5">
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Step 3</p>
          <h2 className="mt-2 text-xl font-semibold">连接当前聊天</h2>
          <div className="mt-4 space-y-3">
            <input
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/6 px-4 text-sm outline-none placeholder:text-zinc-500 focus:border-[#9fe870]"
              placeholder="Match ID"
              value={matchId}
              onChange={(event) => setMatchId(event.target.value)}
            />
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={connectAndJoin}
                className="h-12 rounded-2xl bg-[#9fe870] text-sm font-semibold text-zinc-950"
              >
                连接
              </button>
              <button
                type="button"
                onClick={disconnect}
                className="h-12 rounded-2xl border border-white/10 bg-white/6 text-sm text-white"
              >
                断开
              </button>
              <button
                type="button"
                onClick={requestWallState}
                className="h-12 rounded-2xl border border-white/10 bg-white/6 text-sm text-white"
              >
                状态
              </button>
            </div>
          </div>
        </section>

        {wallReady && !wallBroken ? (
          <section className="mw-card p-4">
            <p className="text-sm font-semibold text-zinc-900">已达到破壁条件</p>
            <p className="mt-2 text-sm leading-7 text-zinc-600">
              当双方都点击同意后，会显示真实昵称并切换为直连聊天。
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => sendWallDecision(true)}
                className="h-11 rounded-2xl bg-zinc-950 text-sm font-medium text-white"
              >
                同意破壁
              </button>
              <button
                type="button"
                onClick={() => sendWallDecision(false)}
                className="h-11 rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-700"
              >
                先不破壁
              </button>
            </div>
          </section>
        ) : null}

        {wallBroken ? (
          <section className="mw-card p-4">
            <p className="text-sm font-semibold text-zinc-900">破壁成功</p>
            <p className="mt-2 text-sm leading-7 text-zinc-600">
              我的昵称：{selfProfile?.realName || "未设置"}；对方昵称：
              {counterpartProfile?.realName || "未设置"}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              我方同意 {requesterAccepted ? "是" : "否"}，对方同意{" "}
              {counterpartAccepted ? "是" : "否"}
            </p>
          </section>
        ) : null}

        <section className="mw-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-900">消息流</p>
              <p className="mt-1 text-xs text-zinc-500">
                {wallBroken
                  ? "当前已是直连模式"
                  : "当前仍在沙盒模式，系统会先审查再投递"}
              </p>
            </div>
          </div>

          <div
            ref={listRef}
            className="mt-4 max-h-[36svh] min-h-[260px] space-y-3 overflow-y-auto rounded-[22px] bg-zinc-50 p-3"
          >
            {logs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-4 text-sm leading-7 text-zinc-500">
                连接成功后，聊天记录会显示在这里。
              </div>
            ) : (
              logs.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl px-4 py-3 text-sm leading-7 ${
                    item.role === "mine"
                      ? "ml-10 bg-zinc-950 text-white"
                      : item.role === "peer"
                        ? "mr-10 bg-white text-zinc-800 shadow-sm"
                        : "border border-zinc-200 bg-zinc-100 text-zinc-700"
                  }`}
                >
                  <p className="mb-1 text-xs opacity-60">
                    {item.role === "mine"
                      ? "我"
                      : item.role === "peer"
                        ? "对方"
                        : "系统"}{" "}
                    · {item.ts}
                  </p>
                  <p>{item.text}</p>
                </div>
              ))
            )}
          </div>

          <form className="mt-4 space-y-3" onSubmit={sendMessage}>
            <textarea
              className="min-h-28 w-full rounded-[22px] border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-zinc-950"
              placeholder={
                wallBroken
                  ? "输入消息，当前为直连聊天"
                  : "输入消息，当前会先经过 AI 安全中间层"
              }
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <button
              type="submit"
              className="h-11 w-full rounded-2xl bg-zinc-950 text-sm font-medium text-white"
            >
              发送消息
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

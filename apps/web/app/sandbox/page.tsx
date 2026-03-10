"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3000";
const wsBaseUrl =
  process.env.NEXT_PUBLIC_WS_BASE_URL?.trim() ||
  apiBaseUrl.replace(/^http/i, (value) =>
    value.toLowerCase() === "https" ? "wss" : "ws",
  );

const userIdStorageKey = "mindwall_user_id";

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
  const autoJoinAfterOpenRef = useRef(false);

  const [userId, setUserId] = useState("");
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

  const wsUrl = useMemo(() => `${wsBaseUrl}/ws/sandbox`, []);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const fromQueryUserId = search.get("user_id")?.trim() || "";
    const fromQueryMatchId = search.get("match_id")?.trim() || "";
    const fromStorage = window.localStorage.getItem(userIdStorageKey) || "";

    const nextUserId = fromQueryUserId || fromStorage;
    if (nextUserId) {
      setUserId(nextUserId);
      window.localStorage.setItem(userIdStorageKey, nextUserId);
    }
    if (fromQueryMatchId) {
      setMatchId(fromQueryMatchId);
    }
  }, []);

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

  function resetWallState() {
    setResonanceScore(null);
    setWallReady(false);
    setWallBroken(false);
    setRequesterAccepted(false);
    setCounterpartAccepted(false);
    setSelfProfile(null);
    setCounterpartProfile(null);
  }

  function sendJson(payload: Record<string, unknown>) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("请先连接聊天服务器。");
      return;
    }
    wsRef.current.send(JSON.stringify(payload));
  }

  function connectSocket(autoJoin: boolean) {
    setError("");

    if (!userId.trim()) {
      setError("请填写用户 ID。");
      return;
    }
    if (autoJoin && !matchId.trim()) {
      setError("请填写 Match ID。");
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (autoJoin) {
        sendAuthAndJoin();
      }
      return;
    }

    autoJoinAfterOpenRef.current = autoJoin;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      appendLog("system", "已连接聊天服务器。");
      sendJson({
        type: "auth",
        user_id: userId.trim(),
      });
      if (autoJoinAfterOpenRef.current) {
        sendJson({
          type: "join_match",
          match_id: matchId.trim(),
        });
      }
      window.localStorage.setItem(userIdStorageKey, userId.trim());
    };

    socket.onmessage = (event) => {
      let payload: WsMessage = {};
      try {
        payload = JSON.parse(String(event.data || "{}"));
      } catch {
        appendLog("system", "收到无法解析的消息。");
        return;
      }

      if (payload.type === "connected") {
        return;
      }

      if (payload.type === "auth_ok") {
        appendLog("system", "身份验证成功。");
        return;
      }

      if (payload.type === "join_ok") {
        resetWallState();
        const score = Number(payload.resonance_score ?? NaN);
        if (Number.isFinite(score)) {
          setResonanceScore(score);
        }
        setWallReady(Boolean(payload.wall_ready));
        setWallBroken(Boolean(payload.wall_broken));
        setRequesterAccepted(Boolean(payload.requester_accepted));
        setCounterpartAccepted(Boolean(payload.counterpart_accepted));
        setSelfProfile(toProfile(payload.self_profile));
        setCounterpartProfile(toProfile(payload.counterpart_profile));
        appendLog("system", "已进入本场聊天。");
        sendJson({
          type: "fetch_history",
          match_id: matchId.trim(),
          limit: 50,
        });
        return;
      }

      if (payload.type === "history") {
        const rows = Array.isArray(payload.messages) ? payload.messages : [];
        for (const row of rows) {
          const item = row as Record<string, unknown>;
          const sender = String(item.sender_id || "");
          const rewritten = String(item.ai_rewritten_text || "");
          appendLog(sender === userId.trim() ? "mine" : "peer", rewritten);
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
        const score = Number(payload.resonance_score ?? NaN);
        if (Number.isFinite(score)) {
          setResonanceScore(score);
        }
        return;
      }

      if (payload.type === "wall_ready") {
        setWallReady(true);
        appendLog("system", "共振分达到 100，可申请破壁。");
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

  function sendAuthAndJoin() {
    if (!userId.trim()) {
      setError("请填写用户 ID。");
      return;
    }
    if (!matchId.trim()) {
      setError("请填写 Match ID。");
      return;
    }

    sendJson({
      type: "auth",
      user_id: userId.trim(),
    });
    sendJson({
      type: "join_match",
      match_id: matchId.trim(),
    });
    window.localStorage.setItem(userIdStorageKey, userId.trim());
  }

  function refreshWallState() {
    if (!matchId.trim()) {
      setError("请填写 Match ID。");
      return;
    }
    sendJson({
      type: "wall_state",
      match_id: matchId.trim(),
    });
  }

  function sendWallDecision(accept: boolean) {
    if (!matchId.trim()) {
      setError("请填写 Match ID。");
      return;
    }
    sendJson({
      type: "wall_break_decision",
      match_id: matchId.trim(),
      accept,
    });
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    setError("");

    const content = text.trim();
    if (!content) {
      setError("消息不能为空。");
      return;
    }
    if (!matchId.trim()) {
      setError("请先进入聊天。");
      return;
    }

    sendJson({
      type: wallBroken ? "direct_message" : "sandbox_message",
      match_id: matchId.trim(),
      text: content,
    });
    setText("");
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans">
      <main className="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-[0.95fr_1.05fr]">
        <section className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold tracking-[0.25em] text-zinc-500">
            MINDWALL | 沙盒聊天
          </p>
          <h1 className="text-2xl font-semibold text-zinc-900">安全对话</h1>
          <p className="text-sm leading-7 text-zinc-600">
            破壁前消息会经过 AI 安全中间层；破壁后自动切换为直连聊天。
          </p>

          <div className="space-y-3 rounded-2xl bg-zinc-100 p-4">
            <input
              className="h-11 w-full rounded-xl border border-zinc-300 px-4 text-sm outline-none focus:border-zinc-500"
              placeholder="用户 ID"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
            <input
              className="h-11 w-full rounded-xl border border-zinc-300 px-4 text-sm outline-none focus:border-zinc-500"
              placeholder="Match ID"
              value={matchId}
              onChange={(event) => setMatchId(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => connectSocket(true)}
                className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white"
              >
                一键连接并进入聊天
              </button>
              {!connected ? (
                <button
                  type="button"
                  onClick={() => connectSocket(false)}
                  className="h-10 rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700"
                >
                  仅连接
                </button>
              ) : (
                <button
                  type="button"
                  onClick={disconnect}
                  className="h-10 rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700"
                >
                  断开连接
                </button>
              )}
              <button
                type="button"
                onClick={sendAuthAndJoin}
                className="h-10 rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700"
              >
                重新进入聊天
              </button>
            </div>
          </div>

          <div className="space-y-1 rounded-2xl bg-zinc-100 p-4 text-sm text-zinc-700">
            <p>连接状态：{connected ? "已连接" : "未连接"}</p>
            <p>WebSocket 地址：{wsUrl}</p>
            <p>共振分：{resonanceScore ?? "暂无"}</p>
            <p>聊天模式：{wallBroken ? "直连模式" : "AI 沙盒模式"}</p>
            <p>我方已同意破壁：{requesterAccepted ? "是" : "否"}</p>
            <p>对方已同意破壁：{counterpartAccepted ? "是" : "否"}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={refreshWallState}
              className="h-10 rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700"
            >
              刷新破壁状态
            </button>
            {wallReady && !wallBroken ? (
              <>
                <button
                  type="button"
                  onClick={() => sendWallDecision(true)}
                  className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white"
                >
                  同意破壁
                </button>
                <button
                  type="button"
                  onClick={() => sendWallDecision(false)}
                  className="h-10 rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700"
                >
                  暂不破壁
                </button>
              </>
            ) : null}
          </div>

          {wallBroken ? (
            <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">
                已破壁，双方资料已解锁
              </p>
              <p className="text-xs text-emerald-700">
                我的昵称：{selfProfile?.realName || "未设置"} | 对方昵称：
                {counterpartProfile?.realName || "未设置"}
              </p>
              {counterpartProfile?.realAvatar ? (
                <img
                  src={counterpartProfile.realAvatar}
                  alt="counterpart avatar"
                  className="h-14 w-14 rounded-full object-cover"
                />
              ) : null}
            </div>
          ) : null}

          <Link
            href="/matches"
            className="inline-flex h-10 items-center rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700"
          >
            返回匹配页
          </Link>
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">聊天窗口</h2>
          <div className="mt-3 h-[470px] space-y-3 overflow-y-auto rounded-2xl bg-zinc-50 p-4">
            {logs.length === 0 ? (
              <p className="text-sm text-zinc-500">连接后开始收发消息。</p>
            ) : (
              logs.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl px-4 py-3 text-sm leading-7 ${
                    item.role === "mine"
                      ? "ml-10 bg-zinc-900 text-zinc-100"
                      : item.role === "peer"
                        ? "mr-10 bg-white text-zinc-800"
                        : "border border-zinc-200 bg-zinc-100 text-zinc-700"
                  }`}
                >
                  <p className="mb-1 text-xs opacity-60">
                    {item.role === "mine" ? "我" : item.role === "peer" ? "对方" : "系统"} ·{" "}
                    {item.ts}
                  </p>
                  <p>{item.text}</p>
                </div>
              ))
            )}
          </div>

          <form className="mt-4 space-y-2" onSubmit={sendMessage}>
            <textarea
              className="min-h-24 w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm leading-6 outline-none focus:border-zinc-500"
              placeholder={
                wallBroken
                  ? "输入消息（当前为直连模式）"
                  : "输入消息（将先经过 AI 安全中间层）"
              }
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-500">
                {wallBroken
                  ? "当前为直连模式，不再改写消息。"
                  : "当前为沙盒模式，系统会先审查并改写。"}
              </p>
              <button
                type="submit"
                className="h-10 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white"
              >
                发送
              </button>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </form>
        </section>
      </main>
    </div>
  );
}

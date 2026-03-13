"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppLoadingScreen, AppShell } from '../../components/app-shell';
import { fetchCurrentViewer, logout, type Viewer } from '../../lib/auth-client';
import { readApiError } from '../../lib/api-error';
import { apiBaseUrl, wsBaseUrl } from '../../lib/config';
import { getAuthHeaders } from '../../lib/session';

type PublicTag = {
  tag_name: string;
  weight: number;
  ai_justification: string;
};

type RealContact = {
  type: 'real';
  key: string;
  name: string;
  avatar: string | null;
  city: string | null;
  subtitle: string;
  tags: PublicTag[];
  updatedAt: string;
};

type VirtualContact = {
  contact_id: string;
  name: string;
  avatar: string | null;
  city: string | null;
  public_tags: PublicTag[];
  updated_at: string;
};

type AiContact = {
  type: 'ai';
  key: string;
  name: string;
  avatar: string | null;
  city: string | null;
  subtitle: string;
  tags: PublicTag[];
  updatedAt: string;
};

type MixedContact = RealContact | AiContact;

type ChatLine = {
  id: string;
  role: 'mine' | 'peer' | 'system';
  text: string;
  ts: string;
};

type WsMessage = {
  type?: string;
  [key: string]: unknown;
};

const virtualContactStorageKey = 'mindwall_virtual_contacts';

function readVirtualContacts(): VirtualContact[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(virtualContactStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        const contactId = String(row.contact_id || '').trim();
        if (!contactId) {
          return null;
        }

        return {
          contact_id: contactId,
          name: String(row.name || '匿名联系人'),
          avatar: typeof row.avatar === 'string' ? row.avatar : null,
          city: typeof row.city === 'string' ? row.city : null,
          public_tags: Array.isArray(row.public_tags)
            ? (row.public_tags as PublicTag[])
            : [],
          updated_at:
            typeof row.updated_at === 'string'
              ? row.updated_at
              : new Date().toISOString(),
        } satisfies VirtualContact;
      })
      .filter((item): item is VirtualContact => Boolean(item));
  } catch {
    return [];
  }
}

function writeVirtualContacts(list: VirtualContact[]) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(virtualContactStorageKey, JSON.stringify(list));
}

function readAiHistory(contactId: string): ChatLine[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(`mindwall_ai_chat_${contactId}`);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        const role = row.role === 'mine' || row.role === 'peer' || row.role === 'system'
          ? row.role
          : null;
        const text = String(row.text || '').trim();
        const ts = typeof row.ts === 'string' ? row.ts : new Date().toLocaleTimeString();
        const id = String(row.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
        if (!role || !text) {
          return null;
        }
        return { id, role, text, ts } as ChatLine;
      })
      .filter((item): item is ChatLine => Boolean(item));
  } catch {
    return [];
  }
}

function writeAiHistory(contactId: string, messages: ChatLine[]) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(
    `mindwall_ai_chat_${contactId}`,
    JSON.stringify(messages.slice(-200)),
  );
}

function updateVirtualContactUpdatedAt(contactId: string) {
  const next = readVirtualContacts().map((item) =>
    item.contact_id === contactId
      ? {
          ...item,
          updated_at: new Date().toISOString(),
        }
      : item,
  );
  writeVirtualContacts(next);
  return next;
}

function AvatarCard({ src, alt }: { src: string | null | undefined; alt: string }) {
  if (!src) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 text-sm text-zinc-500">
        ?
      </div>
    );
  }

  return <img src={src} alt={alt} className="h-12 w-12 rounded-xl object-cover" />;
}

export default function ChatPage() {
  const wsRef = useRef<WebSocket | null>(null);
  const selectedRealMatchIdRef = useRef('');

  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [checking, setChecking] = useState(true);

  const [realContacts, setRealContacts] = useState<RealContact[]>([]);
  const [virtualContacts, setVirtualContacts] = useState<VirtualContact[]>([]);
  const [selectedId, setSelectedId] = useState('');

  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);

  const [resonanceScore, setResonanceScore] = useState<number | null>(null);
  const [wallReady, setWallReady] = useState(false);
  const [wallBroken, setWallBroken] = useState(false);
  const [requesterAccepted, setRequesterAccepted] = useState(false);
  const [counterpartAccepted, setCounterpartAccepted] = useState(false);

  const [error, setError] = useState('');

  const contacts = useMemo<MixedContact[]>(() => {
    const aiContacts: AiContact[] = virtualContacts.map((item) => ({
      type: 'ai',
      key: item.contact_id,
      name: item.name,
      avatar: item.avatar,
      city: item.city,
      subtitle: '可直接对话',
      tags: item.public_tags,
      updatedAt: item.updated_at,
    }));

    return [...realContacts, ...aiContacts].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [realContacts, virtualContacts]);

  const selectedContact = useMemo(
    () => contacts.find((item) => `${item.type}:${item.key}` === selectedId) || null,
    [contacts, selectedId],
  );

  useEffect(() => {
    async function bootstrap() {
      try {
        const nextViewer = await fetchCurrentViewer();
        if (!nextViewer) {
          window.location.replace('/login');
          return;
        }

        setViewer(nextViewer);
        await loadContactsInternal();
      } catch (err) {
        setError((err as Error).message || '加载聊天页失败。');
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
    if (!viewer?.user.id) {
      return;
    }

    const ws = new WebSocket(`${wsBaseUrl}/ws/sandbox`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(
        JSON.stringify({
          type: 'auth',
          user_id: viewer.user.id,
        }),
      );

      if (selectedRealMatchIdRef.current) {
        ws.send(
          JSON.stringify({
            type: 'join_match',
            match_id: selectedRealMatchIdRef.current,
          }),
        );
        ws.send(
          JSON.stringify({
            type: 'fetch_history',
            match_id: selectedRealMatchIdRef.current,
            limit: 80,
          }),
        );
      }
    };

    ws.onmessage = (event) => {
      let payload: WsMessage = {};
      try {
        payload = JSON.parse(String(event.data || '{}'));
      } catch {
        return;
      }

      const eventType = String(payload.type || '');
      const matchId = String(payload.match_id || '');
      const currentMatchId = selectedRealMatchIdRef.current;

      if (eventType === 'history' && matchId === currentMatchId) {
        const rows = Array.isArray(payload.messages)
          ? (payload.messages as Array<Record<string, unknown>>)
          : [];

        const mapped: ChatLine[] = rows.map((row, index) => {
          const senderId = String(row.sender_id || '');
          return {
            id: String(row.message_id || `${Date.now()}-${index}`),
            role: senderId === viewer.user.id ? 'mine' : 'peer',
            text: String(row.ai_rewritten_text || ''),
            ts: new Date(String(row.created_at || Date.now())).toLocaleTimeString(),
          };
        });

        setMessages(mapped);
        return;
      }

      if (eventType === 'join_ok' && matchId === currentMatchId) {
        setResonanceScore(Number(payload.resonance_score || 0));
        setWallReady(Boolean(payload.wall_ready));
        setWallBroken(Boolean(payload.wall_broken));
        setRequesterAccepted(Boolean(payload.requester_accepted));
        setCounterpartAccepted(Boolean(payload.counterpart_accepted));
        return;
      }

      if (eventType === 'message_delivered' && matchId === currentMatchId) {
        setMessages((prev) => [
          ...prev,
          {
            id: String(payload.message_id || `${Date.now()}`),
            role: 'mine',
            text: String(payload.text || payload.original_text || ''),
            ts: new Date().toLocaleTimeString(),
          },
        ]);
        return;
      }

      if (
        (eventType === 'sandbox_message' || eventType === 'direct_message') &&
        matchId === currentMatchId
      ) {
        setMessages((prev) => [
          ...prev,
          {
            id: String(payload.message_id || `${Date.now()}`),
            role: 'peer',
            text: String(payload.text || ''),
            ts: new Date().toLocaleTimeString(),
          },
        ]);
        return;
      }

      if (eventType === 'message_blocked' && matchId === currentMatchId) {
        setMessages((prev) => [
          ...prev,
          {
            id: String(payload.message_id || `${Date.now()}`),
            role: 'system',
            text: `消息被拦截：${String(payload.reason || '触发安全规则')}`,
            ts: new Date().toLocaleTimeString(),
          },
        ]);
        return;
      }

      if (eventType === 'resonance_update' && matchId === currentMatchId) {
        setResonanceScore(Number(payload.resonance_score || 0));
        return;
      }

      if (
        (eventType === 'wall_ready' ||
          eventType === 'wall_state' ||
          eventType === 'wall_break_update' ||
          eventType === 'wall_broken') &&
        matchId === currentMatchId
      ) {
        setWallReady(Boolean(payload.wall_ready));
        setWallBroken(Boolean(payload.wall_broken));
        setRequesterAccepted(Boolean(payload.requester_accepted));
        setCounterpartAccepted(Boolean(payload.counterpart_accepted));
      }
    };

    ws.onerror = () => {
      setError('聊天连接异常。');
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };

    return () => {
      ws.close();
    };
  }, [viewer?.user.id]);

  useEffect(() => {
    if (contacts.length === 0) {
      setSelectedId('');
      setMessages([]);
      return;
    }

    const query = new URLSearchParams(window.location.search);
    const queryMode = query.get('mode');
    const queryMatchId = query.get('match_id');
    const queryContactId = query.get('contact_id');

    let targetId = '';
    if (queryMode === 'real' && queryMatchId) {
      targetId = `real:${queryMatchId}`;
    } else if (queryMode === 'ai' && queryContactId) {
      targetId = `ai:${queryContactId}`;
    }

    const exists = targetId && contacts.some((item) => `${item.type}:${item.key}` === targetId);

    if (exists) {
      setSelectedId(targetId);
      return;
    }

    if (!selectedId || !contacts.some((item) => `${item.type}:${item.key}` === selectedId)) {
      setSelectedId(`${contacts[0].type}:${contacts[0].key}`);
    }
  }, [contacts]);

  useEffect(() => {
    if (!selectedContact || !viewer) {
      return;
    }

    setError('');

    if (selectedContact.type === 'ai') {
      selectedRealMatchIdRef.current = '';
      setResonanceScore(null);
      setWallReady(false);
      setWallBroken(false);
      setRequesterAccepted(false);
      setCounterpartAccepted(false);
      setMessages(readAiHistory(selectedContact.key));
      return;
    }

    selectedRealMatchIdRef.current = selectedContact.key;
    setMessages([]);
    setResonanceScore(null);
    setWallReady(false);
    setWallBroken(false);
    setRequesterAccepted(false);
    setCounterpartAccepted(false);

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'join_match',
          match_id: selectedContact.key,
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'fetch_history',
          match_id: selectedContact.key,
          limit: 80,
        }),
      );
    }
  }, [selectedContact?.type, selectedContact?.key, viewer?.user.id]);

  async function loadContactsInternal() {
    const [realResponse, virtual] = await Promise.all([
      fetch(`${apiBaseUrl}/contacts/me/list`, {
        headers: getAuthHeaders(),
      }),
      Promise.resolve(readVirtualContacts()),
    ]);

    if (!realResponse.ok) {
      throw new Error(await readApiError(realResponse, '读取联系人失败。'));
    }

    const data = (await realResponse.json()) as {
      contacts?: Array<{
        match_id: string;
        name: string;
        avatar: string | null;
        city: string | null;
        status: string;
        resonance_score: number;
        updated_at: string;
        public_tags: PublicTag[];
      }>;
    };

    const mappedReal: RealContact[] = (data.contacts || []).map((item) => ({
      type: 'real',
      key: item.match_id,
      name: item.name,
      avatar: item.avatar,
      city: item.city,
      subtitle: `共振 ${item.resonance_score} · ${item.status}`,
      tags: item.public_tags,
      updatedAt: item.updated_at,
    }));

    setRealContacts(mappedReal);
    setVirtualContacts(virtual);
  }

  function appendAiMessage(contactId: string, line: ChatLine) {
    setMessages((prev) => {
      const next = [...prev, line];
      writeAiHistory(contactId, next);
      return next;
    });
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || !selectedContact || !viewer) {
      return;
    }

    setInput('');
    setSending(true);
    setError('');

    try {
      if (selectedContact.type === 'ai') {
        const mineLine: ChatLine = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          role: 'mine',
          text: content,
          ts: new Date().toLocaleTimeString(),
        };
        const nextLocal = [...messages, mineLine];
        setMessages(nextLocal);
        writeAiHistory(selectedContact.key, nextLocal);

        const historyPayload = nextLocal
          .slice(-24)
          .map((item) => ({
            role: item.role === 'mine' ? 'user' : 'assistant',
            text: item.text,
          }));

        const response = await fetch(`${apiBaseUrl}/companion/respond`, {
          method: 'POST',
          headers: getAuthHeaders({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            companion_id: selectedContact.key,
            history: historyPayload,
          }),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, '回复失败，请稍后再试。'));
        }

        const data = (await response.json()) as { reply?: string };
        const peerLine: ChatLine = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          role: 'peer',
          text: data.reply || '收到。我们继续聊。',
          ts: new Date().toLocaleTimeString(),
        };
        appendAiMessage(selectedContact.key, peerLine);

        const nextVirtual = updateVirtualContactUpdatedAt(selectedContact.key);
        setVirtualContacts(nextVirtual);
        return;
      }

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('聊天连接不可用，请稍后重试。');
      }

      ws.send(
        JSON.stringify({
          type: wallBroken ? 'direct_message' : 'sandbox_message',
          match_id: selectedContact.key,
          text: content,
        }),
      );
    } catch (err) {
      setError((err as Error).message || '发送失败。');
    } finally {
      setSending(false);
    }
  }

  function sendWallDecision(accept: boolean) {
    if (!selectedContact || selectedContact.type !== 'real') {
      return;
    }

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('聊天连接不可用，请稍后重试。');
      return;
    }

    ws.send(
      JSON.stringify({
        type: 'wall_break_decision',
        match_id: selectedContact.key,
        accept,
      }),
    );
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      window.location.replace('/login');
    }
  }

  if (checking) {
    return <AppLoadingScreen label="正在加载聊天..." />;
  }

  if (!viewer) {
    return null;
  }

  return (
    <AppShell
      title="聊天"
      subtitle="联系人列表与聊天窗口统一展示。选择联系人后即可开始对话。"
      actions={
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex h-10 items-center rounded-xl border border-black/10 bg-white px-4 text-sm text-zinc-700"
        >
          退出
        </button>
      }
      status={
        <>
          <span className="mw-chip">连接 {connected ? '已连接' : '未连接'}</span>
          <span className="mw-chip">共振 {resonanceScore ?? '-'}</span>
          <span className="mw-chip">模式 {wallBroken ? '直连' : '沙盒'}</span>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <section className="mw-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-zinc-900">联系人</h2>
            <button
              type="button"
              onClick={() => void loadContactsInternal()}
              className="h-8 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-700"
            >
              刷新
            </button>
          </div>

          {contacts.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
              暂无联系人，请先去联系人页建立匹配。
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {contacts.map((item) => {
                const id = `${item.type}:${item.key}`;
                const active = id === selectedId;

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedId(id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      active
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-100 bg-white text-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <AvatarCard src={item.avatar} alt={item.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.name}</p>
                        <p className={`mt-1 truncate text-xs ${active ? 'text-zinc-300' : 'text-zinc-500'}`}>
                          {item.city || '同城'} · {item.subtitle}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="mw-card p-4">
          {!selectedContact ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-2xl bg-zinc-50 text-sm text-zinc-600">
              选择一个联系人开始聊天。
            </div>
          ) : (
            <div className="space-y-4">
              <header className="rounded-2xl border border-zinc-100 bg-white p-3">
                <div className="flex items-center gap-3">
                  <AvatarCard src={selectedContact.avatar} alt={selectedContact.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900">{selectedContact.name}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {selectedContact.city || '同城'} · {selectedContact.subtitle}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedContact.tags.slice(0, 5).map((tag) => (
                    <span
                      key={`${selectedContact.type}-${selectedContact.key}-${tag.tag_name}`}
                      className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] text-zinc-600"
                    >
                      {tag.tag_name}
                    </span>
                  ))}
                </div>
              </header>

              {selectedContact.type === 'real' && wallReady && !wallBroken ? (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-semibold text-amber-900">已达到破壁条件</p>
                  <p className="mt-1 text-xs leading-6 text-amber-800">
                    双方都同意后将切换到直连聊天。当前同意状态：我方 {requesterAccepted ? '已同意' : '未同意'}，
                    对方 {counterpartAccepted ? '已同意' : '未同意'}。
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => sendWallDecision(true)}
                      className="h-9 rounded-lg bg-zinc-950 text-xs font-medium text-white"
                    >
                      同意破壁
                    </button>
                    <button
                      type="button"
                      onClick={() => sendWallDecision(false)}
                      className="h-9 rounded-lg border border-zinc-300 bg-white text-xs font-medium text-zinc-700"
                    >
                      先不破壁
                    </button>
                  </div>
                </section>
              ) : null}

              <div className="max-h-[52svh] min-h-[360px] space-y-3 overflow-y-auto rounded-2xl bg-zinc-50 p-3">
                {messages.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                    还没有消息，发送第一句开始对话。
                  </div>
                ) : (
                  messages.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-xl px-4 py-3 text-sm leading-7 ${
                        item.role === 'mine'
                          ? 'ml-10 bg-zinc-950 text-white'
                          : item.role === 'peer'
                            ? 'mr-10 bg-white text-zinc-800 shadow-sm'
                            : 'border border-zinc-200 bg-zinc-100 text-zinc-700'
                      }`}
                    >
                      <p className="mb-1 text-[11px] opacity-60">{item.ts}</p>
                      <p>{item.text}</p>
                    </div>
                  ))
                )}
              </div>

              <form className="space-y-3" onSubmit={sendMessage}>
                <textarea
                  className="min-h-24 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-zinc-950"
                  placeholder="输入消息..."
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="h-11 w-full rounded-xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {sending ? '发送中...' : '发送'}
                </button>
              </form>
            </div>
          )}

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

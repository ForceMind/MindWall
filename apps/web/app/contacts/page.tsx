"use client";

import { useEffect, useMemo, useState } from 'react';
import { AppLoadingScreen, AppShell } from '../../components/app-shell';
import { fetchCurrentViewer, logout, type Viewer } from '../../lib/auth-client';
import { readApiError } from '../../lib/api-error';
import { apiBaseUrl } from '../../lib/config';
import { getAuthHeaders } from '../../lib/session';

type PublicTag = {
  tag_name: string;
  weight: number;
  ai_justification: string;
};

type Candidate = {
  candidate_id: string;
  candidate_type: 'user' | 'ai';
  is_ai: boolean;
  city: string | null;
  avatar: string | null;
  name: string;
  score: number;
  has_match: boolean;
  match_id: string | null;
  match_status: string | null;
  resonance_score: number | null;
  public_tags: PublicTag[];
};

type ContactsResponse = {
  total: number;
  contacts: Array<{
    match_id: string;
    counterpart_user_id: string;
    name: string;
    avatar: string | null;
    city: string | null;
    status: string;
    resonance_score: number;
    updated_at: string;
    public_tags: PublicTag[];
  }>;
};

type CandidateResponse = {
  city_scope: string | null;
  candidates: Candidate[];
};

type ChatMessage = {
  role: 'assistant' | 'user';
  text: string;
};

type VirtualContact = {
  contact_id: string;
  name: string;
  avatar: string | null;
  city: string | null;
  public_tags: PublicTag[];
  updated_at: string;
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

function upsertVirtualContact(contact: VirtualContact) {
  const current = readVirtualContacts();
  const next = [
    contact,
    ...current.filter((item) => item.contact_id !== contact.contact_id),
  ];
  writeVirtualContacts(next);
  return next;
}

function AvatarCard({ src, alt }: { src: string | null | undefined; alt: string }) {
  if (!src) {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500">
        ?
      </div>
    );
  }

  return <img src={src} alt={alt} className="h-14 w-14 rounded-2xl object-cover" />;
}

function getStep(viewer: Viewer | null) {
  const profile = viewer?.profile;
  const basicsDone = Boolean(profile?.gender && profile?.age && profile?.anonymous_name);
  const interviewDone = Boolean((viewer?.public_tags.length || 0) > 0);
  const cityDone = Boolean(profile?.city);

  if (!basicsDone) {
    return '基础资料';
  }
  if (!interviewDone) {
    return '心灵访谈';
  }
  if (!cityDone) {
    return '选择城市';
  }
  return '可匹配';
}

export default function ContactsPage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [checking, setChecking] = useState(true);
  const [contacts, setContacts] = useState<ContactsResponse['contacts']>([]);
  const [virtualContacts, setVirtualContacts] = useState<VirtualContact[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);

  const [gender, setGender] = useState('female');
  const [age, setAge] = useState('25');
  const [city, setCity] = useState('');

  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [summary, setSummary] = useState('');

  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [workingInterview, setWorkingInterview] = useState(false);
  const [savingBasics, setSavingBasics] = useState(false);
  const [savingCity, setSavingCity] = useState(false);
  const [connectingId, setConnectingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const basicsDone = Boolean(
    viewer?.profile?.gender && viewer?.profile?.age && viewer?.profile?.anonymous_name,
  );
  const interviewDone = Boolean((viewer?.public_tags.length || 0) > 0);
  const cityDone = Boolean(viewer?.profile?.city);

  useEffect(() => {
    async function bootstrap() {
      try {
        const nextViewer = await fetchCurrentViewer();
        if (!nextViewer) {
          window.location.replace('/login');
          return;
        }

        setViewer(nextViewer);
        setGender(nextViewer.profile?.gender || 'female');
        setAge(nextViewer.profile?.age ? String(nextViewer.profile.age) : '25');
        setCity(nextViewer.profile?.city || '');

        await Promise.all([loadContactsInternal(), loadCandidatesInternal()]);
      } catch (err) {
        setError((err as Error).message || '加载联系人失败。');
      } finally {
        setChecking(false);
      }
    }

    void bootstrap();
  }, []);

  const mixedContacts = useMemo(() => {
    const real = contacts.map((item) => ({
      id: `real:${item.match_id}`,
      type: 'real' as const,
      key: item.match_id,
      name: item.name,
      avatar: item.avatar,
      city: item.city,
      updatedAt: item.updated_at,
      subtitle: `共振 ${item.resonance_score} · ${item.status}`,
      tags: item.public_tags,
    }));

    const virtual = virtualContacts.map((item) => ({
      id: `ai:${item.contact_id}`,
      type: 'ai' as const,
      key: item.contact_id,
      name: item.name,
      avatar: item.avatar,
      city: item.city,
      updatedAt: item.updated_at,
      subtitle: '可直接开始对话',
      tags: item.public_tags,
    }));

    return [...real, ...virtual].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [contacts, virtualContacts]);

  const canMatch = basicsDone && interviewDone && cityDone;

  async function refreshViewer() {
    const nextViewer = await fetchCurrentViewer();
    setViewer(nextViewer);
    setCity(nextViewer?.profile?.city || '');
  }

  async function loadContactsInternal() {
    setLoadingContacts(true);
    try {
      const response = await fetch(`${apiBaseUrl}/contacts/me/list`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, '读取联系人失败。'));
      }

      const data = (await response.json()) as ContactsResponse;
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
      setVirtualContacts(readVirtualContacts());
    } catch (err) {
      setError((err as Error).message || '读取联系人失败。');
    } finally {
      setLoadingContacts(false);
    }
  }

  async function loadCandidatesInternal() {
    setLoadingCandidates(true);
    try {
      const response = await fetch(`${apiBaseUrl}/contacts/me/candidates`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, '读取候选失败。'));
      }

      const data = (await response.json()) as CandidateResponse;
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
    } catch (err) {
      setError((err as Error).message || '读取候选失败。');
    } finally {
      setLoadingCandidates(false);
    }
  }

  function gotoRealChat(matchId: string) {
    window.location.href = `/chat?mode=real&match_id=${encodeURIComponent(matchId)}`;
  }

  function gotoAiChat(contactId: string) {
    window.location.href = `/chat?mode=ai&contact_id=${encodeURIComponent(contactId)}`;
  }

  async function handleStartChat(candidate: Candidate) {
    setConnectingId(candidate.candidate_id);
    setError('');
    setSuccess('');

    try {
      if (candidate.candidate_type === 'user') {
        if (candidate.match_id) {
          gotoRealChat(candidate.match_id);
          return;
        }

        const response = await fetch(`${apiBaseUrl}/contacts/me/connect`, {
          method: 'POST',
          headers: getAuthHeaders({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            target_user_id: candidate.candidate_id,
          }),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, '建立联系人失败。'));
        }

        const data = (await response.json()) as { match_id?: string };
        await Promise.all([loadContactsInternal(), loadCandidatesInternal()]);

        if (!data.match_id) {
          throw new Error('建立联系人失败：未返回会话 ID。');
        }

        gotoRealChat(data.match_id);
        return;
      }

      const nextVirtual = upsertVirtualContact({
        contact_id: candidate.candidate_id,
        name: candidate.name,
        avatar: candidate.avatar,
        city: candidate.city,
        public_tags: candidate.public_tags,
        updated_at: new Date().toISOString(),
      });
      setVirtualContacts(nextVirtual);
      gotoAiChat(candidate.candidate_id);
    } catch (err) {
      setError((err as Error).message || '开始聊天失败。');
    } finally {
      setConnectingId('');
    }
  }

  async function saveBasics() {
    setSavingBasics(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch(`${apiBaseUrl}/onboarding/me/profile`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          gender,
          age: Number(age),
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, '保存基础资料失败，请稍后再试。'));
      }

      await refreshViewer();
      setSuccess('基础资料已保存。');
    } catch (err) {
      setError((err as Error).message || '保存基础资料失败。');
    } finally {
      setSavingBasics(false);
    }
  }

  async function startInterview() {
    setWorkingInterview(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch(`${apiBaseUrl}/onboarding/me/session`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, '启动访谈失败，请稍后再试。'));
      }

      const data = (await response.json()) as {
        session_id: string;
        assistant_message: string;
      };

      setSessionId(data.session_id);
      setMessages([{ role: 'assistant', text: data.assistant_message }]);
      setSummary('');
    } catch (err) {
      setError((err as Error).message || '启动访谈失败。');
    } finally {
      setWorkingInterview(false);
    }
  }

  async function sendAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || !sessionId) {
      return;
    }

    setInput('');
    setWorkingInterview(true);
    setError('');
    setMessages((prev) => [...prev, { role: 'user', text: content }]);

    try {
      const response = await fetch(`${apiBaseUrl}/onboarding/me/session/${sessionId}/messages`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ message: content }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, '发送回答失败，请稍后再试。'));
      }

      const data = (await response.json()) as {
        status: string;
        assistant_message?: string;
        onboarding_summary?: string;
      };

      if (data.status === 'completed') {
        await refreshViewer();
        await loadCandidatesInternal();
        setSummary(data.onboarding_summary || '访谈已完成，公开标签已生成。');
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: '访谈完成。请继续选择城市，即可进入匹配。',
          },
        ]);
        setSessionId('');
        setSuccess('访谈已完成，请继续选择城市。');
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.assistant_message || '请继续回答。',
        },
      ]);
    } catch (err) {
      setError((err as Error).message || '发送回答失败。');
    } finally {
      setWorkingInterview(false);
    }
  }

  async function saveCity() {
    setSavingCity(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch(`${apiBaseUrl}/onboarding/me/city`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ city }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, '保存城市失败，请稍后再试。'));
      }

      await refreshViewer();
      await Promise.all([loadContactsInternal(), loadCandidatesInternal()]);
      setSuccess('城市已保存，可以开始匹配与聊天。');
    } catch (err) {
      setError((err as Error).message || '保存城市失败。');
    } finally {
      setSavingCity(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      window.location.replace('/login');
    }
  }

  if (checking) {
    return <AppLoadingScreen label="正在加载联系人..." />;
  }

  if (!viewer) {
    return null;
  }

  return (
    <AppShell
      title="联系人"
      subtitle="完成匿名新手流程后，这里会展示可匹配对象与已建立联系人。"
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
          <span className="mw-chip">{viewer.profile?.anonymous_name || viewer.user.username}</span>
          <span className="mw-chip">城市 {viewer.profile?.city || '未选择'}</span>
          <span className="mw-chip">步骤 {getStep(viewer)}</span>
        </>
      }
    >
      <div className="space-y-4">
        {!canMatch ? (
          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <article className="mw-card-dark p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Start</p>
                <h2 className="mt-2 text-xl font-semibold">完成新手流程</h2>
                <p className="mt-2 text-sm leading-7 text-zinc-300">
                  先完成基础资料、深度访谈和城市选择，再开放候选匹配与聊天。
                </p>
              </article>

              <article className="mw-card p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Step 1</p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-900">基础资料</h3>
                <p className="mt-2 text-sm leading-7 text-zinc-600">
                  仅用于生成匿名身份与安全分层，不会直接公开给他人。
                </p>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    { value: 'female', label: '女' },
                    { value: 'male', label: '男' },
                    { value: 'other', label: '其他' },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setGender(item.value)}
                      className={`h-10 rounded-xl border text-sm ${
                        gender === item.value
                          ? 'border-zinc-950 bg-zinc-950 text-white'
                          : 'border-zinc-200 bg-white text-zinc-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <input
                  className="mt-3 h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950"
                  placeholder="年龄，18-99"
                  inputMode="numeric"
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                />

                <button
                  type="button"
                  onClick={saveBasics}
                  disabled={savingBasics}
                  className="mt-3 h-11 w-full rounded-xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {savingBasics ? '保存中...' : basicsDone ? '更新资料' : '保存并生成匿名身份'}
                </button>
              </article>

              <article className="mw-card p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Step 3</p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-900">选择城市</h3>
                <p className="mt-2 text-sm leading-7 text-zinc-600">
                  城市用于匹配范围。完成后会开放候选列表与聊天入口。
                </p>
                <input
                  className="mt-4 h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950"
                  placeholder="例如：上海"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  disabled={!interviewDone}
                />
                <button
                  type="button"
                  onClick={saveCity}
                  disabled={!interviewDone || savingCity}
                  className="mt-3 h-11 w-full rounded-xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {savingCity ? '保存中...' : cityDone ? '更新城市' : '保存城市'}
                </button>
              </article>
            </div>

            <div className="space-y-4">
              <article className="mw-card p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Step 2</p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-900">心灵访谈</h3>
                <p className="mt-2 text-sm leading-7 text-zinc-600">
                  访谈会生成公开标签，用于后续匹配展示与聊天推荐。
                </p>

                <button
                  type="button"
                  onClick={startInterview}
                  disabled={!basicsDone || workingInterview}
                  className="mt-4 h-11 w-full rounded-xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {workingInterview
                    ? '处理中...'
                    : sessionId
                      ? '重新开始访谈'
                      : interviewDone
                        ? '重新生成标签'
                        : '开始访谈'}
                </button>

                <div className="mt-4 max-h-[36svh] min-h-[220px] space-y-3 overflow-y-auto rounded-2xl bg-zinc-50 p-3">
                  {messages.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-4 text-sm leading-7 text-zinc-500">
                      点击“开始访谈”后，系统会逐步提问并生成公开标签。
                    </div>
                  ) : (
                    messages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={`rounded-xl px-4 py-3 text-sm leading-7 ${
                          message.role === 'assistant'
                            ? 'mr-10 bg-white text-zinc-800 shadow-sm'
                            : 'ml-10 bg-zinc-950 text-white'
                        }`}
                      >
                        <p className="mb-1 text-xs opacity-60">
                          {message.role === 'assistant' ? '访谈引导' : '我'}
                        </p>
                        <p>{message.text}</p>
                      </div>
                    ))
                  )}
                </div>

                <form className="mt-4 space-y-3" onSubmit={sendAnswer}>
                  <textarea
                    className="min-h-24 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-zinc-950"
                    placeholder="输入你的回答..."
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    disabled={!basicsDone || !sessionId}
                  />
                  <button
                    type="submit"
                    disabled={!sessionId || !input.trim() || workingInterview}
                    className="h-11 w-full rounded-xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                  >
                    发送回答
                  </button>
                </form>
              </article>

              <article className="mw-card p-5">
                <p className="text-sm font-semibold text-zinc-900">当前公开标签</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {viewer.public_tags.length === 0 ? (
                    <span className="rounded-full bg-zinc-100 px-3 py-2 text-xs text-zinc-500">
                      访谈完成后生成
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
                <p className="mt-3 text-sm leading-7 text-zinc-600">
                  {summary || '公开标签用于匹配展示，隐藏标签不会在前端展示。'}
                </p>
              </article>
            </div>
          </section>
        ) : (
          <section className="mw-card-dark p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Ready</p>
            <h2 className="mt-2 text-xl font-semibold">已开放匹配与聊天</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-300">
              你已完成新手流程。现在可以在候选中查看头像和标签，点击进入联系人对话。
            </p>
          </section>
        )}

        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <article className="mw-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-zinc-900">我的联系人</h3>
              <button
                type="button"
                onClick={() => void loadContactsInternal()}
                disabled={loadingContacts}
                className="h-9 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-700"
              >
                {loadingContacts ? '刷新中...' : '刷新'}
              </button>
            </div>

            {mixedContacts.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                还没有联系人。先在右侧候选中点击“开始聊天”。
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {mixedContacts.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-zinc-100 bg-white p-3">
                    <div className="flex items-start gap-3">
                      <AvatarCard src={item.avatar} alt={item.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-zinc-900">{item.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {item.city || '未设置城市'} · {item.subtitle}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.tags.slice(0, 3).map((tag) => (
                            <span
                              key={`${item.id}-${tag.tag_name}`}
                              className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] text-zinc-600"
                            >
                              {tag.tag_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (item.type === 'real') {
                          gotoRealChat(item.key);
                          return;
                        }
                        gotoAiChat(item.key);
                      }}
                      className="mt-3 h-10 w-full rounded-xl bg-zinc-950 text-sm font-medium text-white"
                    >
                      打开聊天
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="mw-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-zinc-900">候选匹配</h3>
              <button
                type="button"
                onClick={() => void loadCandidatesInternal()}
                disabled={loadingCandidates}
                className="h-9 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-700"
              >
                {loadingCandidates ? '刷新中...' : '刷新'}
              </button>
            </div>

            {!canMatch ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                完成上方新手流程后，这里会显示候选匹配对象。
              </div>
            ) : candidates.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                当前没有可展示候选，请稍后刷新。
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {candidates.map((item) => (
                  <div key={item.candidate_id} className="rounded-2xl border border-zinc-100 bg-white p-3">
                    <button
                      type="button"
                      onClick={() => setSelectedCandidate(item)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-3">
                        <AvatarCard src={item.avatar} alt={item.name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-zinc-900">{item.name}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.city || '同城候选'} · 匹配分 {item.score}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.public_tags.slice(0, 3).map((tag) => (
                          <span
                            key={`${item.candidate_id}-${tag.tag_name}`}
                            className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] text-zinc-600"
                          >
                            {tag.tag_name}
                          </span>
                        ))}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleStartChat(item)}
                      disabled={connectingId === item.candidate_id}
                      className="mt-3 h-10 w-full rounded-xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                    >
                      {connectingId === item.candidate_id
                        ? '处理中...'
                        : item.has_match && item.match_id
                          ? '继续聊天'
                          : '开始聊天'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        {success ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>

      {selectedCandidate ? (
        <div className="mw-modal" role="dialog" aria-modal="true">
          <div className="mw-card w-full max-w-lg p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <AvatarCard src={selectedCandidate.avatar} alt={selectedCandidate.name} />
                <div>
                  <p className="text-base font-semibold text-zinc-900">{selectedCandidate.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {selectedCandidate.city || '同城候选'} · 匹配分 {selectedCandidate.score}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCandidate(null)}
                className="h-8 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-600"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {selectedCandidate.public_tags.map((tag) => (
                <span
                  key={`${selectedCandidate.candidate_id}-detail-${tag.tag_name}`}
                  className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white"
                >
                  {tag.tag_name}
                </span>
              ))}
            </div>

            <div className="mt-4 space-y-2 text-sm text-zinc-600">
              {selectedCandidate.public_tags.map((tag) => (
                <p key={`${selectedCandidate.candidate_id}-desc-${tag.tag_name}`}>
                  <span className="font-medium text-zinc-800">{tag.tag_name}：</span>
                  {tag.ai_justification}
                </p>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void handleStartChat(selectedCandidate)}
              disabled={connectingId === selectedCandidate.candidate_id}
              className="mt-5 h-11 w-full rounded-xl bg-zinc-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {connectingId === selectedCandidate.candidate_id
                ? '处理中...'
                : selectedCandidate.has_match && selectedCandidate.match_id
                  ? '继续聊天'
                  : '开始聊天'}
            </button>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

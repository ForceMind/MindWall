"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl } from "../../lib/config";

type AdminConfigResponse = {
  openai_base_url: string;
  openai_api_key_configured: boolean;
  openai_api_key_preview: string | null;
  openai_model: string;
  openai_embedding_model: string;
  web_origin: string;
  source: {
    openai_base_url: string;
    openai_api_key: string;
    openai_model: string;
    openai_embedding_model: string;
    web_origin: string;
  };
  updated_at: string | null;
  config_file: string;
};

const tokenStorageKey = "mindwall_admin_token";
const defaultBaseUrl = "https://api.openai.com/v1";
const defaultChatModel = "gpt-4.1-mini";
const defaultEmbeddingModel = "text-embedding-3-small";
const defaultWebOrigin = "http://localhost:3001";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [config, setConfig] = useState<AdminConfigResponse | null>(null);

  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState(defaultChatModel);
  const [embeddingModel, setEmbeddingModel] = useState(defaultEmbeddingModel);
  const [webOrigin, setWebOrigin] = useState(defaultWebOrigin);
  const [clearApiKey, setClearApiKey] = useState(false);

  useEffect(() => {
    const cached = window.localStorage.getItem(tokenStorageKey);
    if (!cached) {
      return;
    }
    setToken(cached);
  }, []);

  function applyConfig(payload: AdminConfigResponse) {
    setConfig(payload);
    setBaseUrl(payload.openai_base_url || defaultBaseUrl);
    setChatModel(payload.openai_model || defaultChatModel);
    setEmbeddingModel(payload.openai_embedding_model || defaultEmbeddingModel);
    setWebOrigin(payload.web_origin || defaultWebOrigin);
  }

  async function loadConfig() {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      setError("请先填写 ADMIN_TOKEN。");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      window.localStorage.setItem(tokenStorageKey, normalizedToken);

      const response = await fetch(`${apiBaseUrl}/admin/config`, {
        headers: {
          "x-admin-token": normalizedToken,
        },
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`读取配置失败：${response.status} ${detail}`);
      }

      const payload = (await response.json()) as AdminConfigResponse;
      applyConfig(payload);
      setSuccess("已读取当前后端配置。");
    } catch (err) {
      setError((err as Error).message || "读取配置失败。");
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      setError("请先填写 ADMIN_TOKEN。");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    const body: Record<string, string> = {
      openai_base_url: baseUrl.trim(),
      openai_model: chatModel.trim(),
      openai_embedding_model: embeddingModel.trim(),
      web_origin: webOrigin.trim(),
    };

    if (apiKey.trim()) {
      body.openai_api_key = apiKey.trim();
    } else if (clearApiKey) {
      body.openai_api_key = "";
    }

    try {
      window.localStorage.setItem(tokenStorageKey, normalizedToken);

      const response = await fetch(`${apiBaseUrl}/admin/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": normalizedToken,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`保存配置失败：${response.status} ${detail}`);
      }

      const payload = (await response.json()) as AdminConfigResponse;
      applyConfig(payload);
      setApiKey("");
      setClearApiKey(false);
      setSuccess("已保存到后端运行时配置。");
    } catch (err) {
      setError((err as Error).message || "保存配置失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f4efe8_0%,#eff2f5_48%,#dde8e0_100%)] px-6 py-8 text-zinc-900">
      <main className="mx-auto w-full max-w-5xl space-y-6">
        <section className="rounded-[28px] border border-black/10 bg-white/85 p-6 backdrop-blur md:p-8">
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            MindWall Admin
          </p>
          <h1 className="mt-2 text-3xl font-semibold">AI 配置后台</h1>
          <p className="mt-3 text-sm leading-7 text-zinc-700">
            这个页面只做一件事：配置后端调用 AI 所需的接口地址、API Key 和模型名称。
            用户前台不会显示这些敏感信息。
          </p>
          <div className="mt-5 grid gap-3 rounded-[24px] bg-zinc-950 p-4 text-sm text-zinc-200 md:grid-cols-2">
            <div>
              <p className="font-medium text-white">你需要填写的 4 项</p>
              <p className="mt-2">1. AI 接口地址</p>
              <p>2. API Key</p>
              <p>3. 聊天模型名</p>
              <p>4. Embedding 模型名</p>
            </div>
            <div>
              <p className="font-medium text-white">官方 OpenAI 默认值</p>
              <p className="mt-2">接口地址：{defaultBaseUrl}</p>
              <p>聊天模型：{defaultChatModel}</p>
              <p>Embedding：{defaultEmbeddingModel}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] bg-zinc-950 p-6 text-zinc-50 shadow-2xl shadow-zinc-950/15 md:p-8">
          <h2 className="text-lg font-semibold">第一步：读取当前配置</h2>
          <p className="mt-2 text-sm leading-7 text-zinc-300">
            先输入你在后端环境变量里设置的 <code>ADMIN_TOKEN</code>，再点“读取当前配置”。
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              className="h-11 rounded-2xl border border-white/15 bg-white/5 px-4 text-sm outline-none placeholder:text-zinc-400 focus:border-emerald-300"
              placeholder="ADMIN_TOKEN"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <button
              type="button"
              onClick={loadConfig}
              disabled={!token.trim() || loading}
              className="h-11 rounded-2xl bg-emerald-300 px-5 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:bg-emerald-100"
            >
              {loading ? "读取中..." : "读取当前配置"}
            </button>
          </div>
        </section>

        <section className="rounded-[28px] border border-black/10 bg-white/85 p-6 backdrop-blur md:p-8">
          <h2 className="text-lg font-semibold">第二步：填写并保存 AI 配置</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm text-zinc-700">
              <span>AI 接口地址</span>
              <input
                className="h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-950"
                placeholder={defaultBaseUrl}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>

            <label className="space-y-2 text-sm text-zinc-700">
              <span>聊天模型</span>
              <input
                className="h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-950"
                placeholder={defaultChatModel}
                value={chatModel}
                onChange={(event) => setChatModel(event.target.value)}
              />
            </label>

            <label className="space-y-2 text-sm text-zinc-700 md:col-span-2">
              <span>API Key</span>
              <input
                className="h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-950"
                placeholder="sk-..."
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>

            <label className="space-y-2 text-sm text-zinc-700">
              <span>Embedding 模型</span>
              <input
                className="h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-950"
                placeholder={defaultEmbeddingModel}
                value={embeddingModel}
                onChange={(event) => setEmbeddingModel(event.target.value)}
              />
            </label>

            <label className="space-y-2 text-sm text-zinc-700">
              <span>前端来源地址</span>
              <input
                className="h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-950"
                placeholder={defaultWebOrigin}
                value={webOrigin}
                onChange={(event) => setWebOrigin(event.target.value)}
              />
            </label>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={clearApiKey}
              onChange={(event) => setClearApiKey(event.target.checked)}
              disabled={apiKey.trim().length > 0}
            />
            清空当前已保存的 API Key
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveConfig}
              disabled={!token.trim() || saving}
              className="h-11 rounded-2xl bg-zinc-950 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {saving ? "保存中..." : "保存到后端"}
            </button>
            <button
              type="button"
              onClick={loadConfig}
              disabled={!token.trim() || loading}
              className="h-11 rounded-2xl border border-zinc-300 px-5 text-sm font-medium text-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-400"
            >
              重新读取
            </button>
          </div>

          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
          {success ? (
            <p className="mt-4 text-sm text-emerald-700">{success}</p>
          ) : null}
        </section>

        <section className="rounded-[28px] border border-black/10 bg-white/85 p-6 backdrop-blur md:p-8">
          <h2 className="text-lg font-semibold">当前生效状态</h2>
          {!config ? (
            <p className="mt-4 text-sm text-zinc-600">
              还没有读取当前配置。先输入 ADMIN_TOKEN，再点击“读取当前配置”。
            </p>
          ) : (
            <div className="mt-4 grid gap-3 text-sm text-zinc-700 md:grid-cols-2">
              <p>AI 接口地址：{config.openai_base_url}</p>
              <p>
                API Key：
                {config.openai_api_key_configured
                  ? `已配置（${config.openai_api_key_preview || "已隐藏"}）`
                  : "未配置"}
              </p>
              <p>聊天模型：{config.openai_model}</p>
              <p>Embedding 模型：{config.openai_embedding_model}</p>
              <p>前端来源地址：{config.web_origin}</p>
              <p>配置文件：{config.config_file}</p>
              <p>最后更新时间：{config.updated_at || "尚未写入"}</p>
              <p className="md:col-span-2">
                字段来源：
                地址({config.source.openai_base_url})，
                Key({config.source.openai_api_key})，
                聊天模型({config.source.openai_model})，
                Embedding({config.source.openai_embedding_model})，
                前端来源({config.source.web_origin})
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

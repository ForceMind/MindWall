"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AdminConfigResponse = {
  openai_api_key_configured: boolean;
  openai_api_key_preview: string | null;
  openai_model: string;
  openai_embedding_model: string;
  web_origin: string;
  source: {
    openai_api_key: string;
    openai_model: string;
    openai_embedding_model: string;
    web_origin: string;
  };
  updated_at: string | null;
  config_file: string;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3000";
const tokenStorageKey = "mindwall_admin_token";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [config, setConfig] = useState<AdminConfigResponse | null>(null);

  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4.1-mini");
  const [openaiEmbeddingModel, setOpenaiEmbeddingModel] = useState(
    "text-embedding-3-small",
  );
  const [webOrigin, setWebOrigin] = useState("http://localhost:3001");
  const [clearApiKey, setClearApiKey] = useState(false);

  useEffect(() => {
    const cached = window.localStorage.getItem(tokenStorageKey);
    if (cached) {
      setToken(cached);
    }
  }, []);

  const hasToken = useMemo(() => token.trim().length > 0, [token]);

  function applyConfig(payload: AdminConfigResponse) {
    setConfig(payload);
    setOpenaiModel(payload.openai_model || "gpt-4.1-mini");
    setOpenaiEmbeddingModel(
      payload.openai_embedding_model || "text-embedding-3-small",
    );
    setWebOrigin(payload.web_origin || "http://localhost:3001");
  }

  async function loadConfig() {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      setError("请先填写后台管理 Token。");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      window.localStorage.setItem(tokenStorageKey, normalizedToken);

      const response = await fetch(`${apiBaseUrl}/admin/config`, {
        method: "GET",
        headers: {
          "x-admin-token": normalizedToken,
        },
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`读取配置失败: ${response.status} ${detail}`);
      }

      const payload = (await response.json()) as AdminConfigResponse;
      applyConfig(payload);
      setSuccess("已读取后端运行时配置。");
    } catch (err) {
      setError((err as Error).message || "读取配置失败。");
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      setError("请先填写后台管理 Token。");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    const body: Record<string, string> = {
      openai_model: openaiModel.trim(),
      openai_embedding_model: openaiEmbeddingModel.trim(),
      web_origin: webOrigin.trim(),
    };

    if (openaiApiKey.trim()) {
      body.openai_api_key = openaiApiKey.trim();
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
        throw new Error(`保存配置失败: ${response.status} ${detail}`);
      }

      const payload = (await response.json()) as AdminConfigResponse;
      applyConfig(payload);
      setOpenaiApiKey("");
      setClearApiKey(false);
      setSuccess("配置已保存到后端。");
    } catch (err) {
      setError((err as Error).message || "保存配置失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans">
      <main className="mx-auto w-full max-w-3xl space-y-5">
        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
          <p className="text-xs font-semibold tracking-[0.25em] text-zinc-500">
            MINDWALL 管理后台
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900">
            AI 接口与运行配置
          </h1>
          <p className="mt-2 text-sm leading-7 text-zinc-600">
            这是独立于用户社交页面的后台管理页。这里写入后端运行时配置文件，不通过前端公开环境变量暴露密钥。
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              className="h-11 rounded-xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-500"
              placeholder="后台 Token（请求头 x-admin-token）"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <button
              type="button"
              onClick={loadConfig}
              disabled={!hasToken || loading}
              className="h-11 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {loading ? "读取中..." : "读取当前配置"}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-sm font-semibold text-zinc-900">更新后端配置</h2>
          <div className="mt-4 space-y-3">
            <input
              className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-500"
              placeholder="OpenAI API Key（留空表示不改）"
              type="password"
              value={openaiApiKey}
              onChange={(event) => setOpenaiApiKey(event.target.value)}
            />

            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={clearApiKey}
                onChange={(event) => setClearApiKey(event.target.checked)}
                disabled={openaiApiKey.trim().length > 0}
              />
              清空已保存的 API Key（仅当上方输入框留空时生效）
            </label>

            <input
              className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-500"
              placeholder="OpenAI 模型"
              value={openaiModel}
              onChange={(event) => setOpenaiModel(event.target.value)}
            />

            <input
              className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-500"
              placeholder="OpenAI Embedding 模型"
              value={openaiEmbeddingModel}
              onChange={(event) => setOpenaiEmbeddingModel(event.target.value)}
            />

            <input
              className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-zinc-500"
              placeholder="Web Origin（如 http://localhost:3001）"
              value={webOrigin}
              onChange={(event) => setWebOrigin(event.target.value)}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveConfig}
              disabled={!hasToken || saving}
              className="h-11 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {saving ? "保存中..." : "保存到后端"}
            </button>
            <Link
              href="/"
              className="inline-flex h-11 items-center rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700"
            >
              返回用户前台
            </Link>
          </div>

          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
          {success ? <p className="mt-4 text-sm text-emerald-700">{success}</p> : null}
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-sm font-semibold text-zinc-900">当前状态</h2>
          {config ? (
            <div className="mt-3 space-y-2 text-sm text-zinc-700">
              <p>
                API Key:{" "}
                {config.openai_api_key_configured
                  ? `已配置（${config.openai_api_key_preview || "已隐藏"}）`
                  : "未配置"}
              </p>
              <p>Chat 模型: {config.openai_model}</p>
              <p>Embedding 模型: {config.openai_embedding_model}</p>
              <p>Web Origin: {config.web_origin}</p>
              <p>配置文件: {config.config_file}</p>
              <p>更新时间: {config.updated_at || "未写入"}</p>
              <p className="text-xs text-zinc-500">
                来源: key({config.source.openai_api_key}), model(
                {config.source.openai_model}), embedding(
                {config.source.openai_embedding_model}), origin(
                {config.source.web_origin})
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">请先读取配置。</p>
          )}
        </section>
      </main>
    </div>
  );
}

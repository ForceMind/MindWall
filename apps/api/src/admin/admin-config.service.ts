import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { ServerLogService } from '../telemetry/server-log.service';
import { AiRuntimeConfig, RuntimeConfig } from './admin.types';

@Injectable()
export class AdminConfigService {
  private readonly logger = new Logger(AdminConfigService.name);
  private readonly configDir = path.join(process.cwd(), 'config');
  private readonly configFile = path.join(this.configDir, 'runtime-config.json');
  private readonly defaultOpenAiBaseUrl = 'https://api.openai.com/v1';

  constructor(private readonly serverLogService: ServerLogService) {}

  async getAiConfig(): Promise<AiRuntimeConfig> {
    const runtime = await this.readRuntimeConfig();
    const runtimeHasEmbeddingApiKey = Object.prototype.hasOwnProperty.call(
      runtime,
      'openai_embedding_api_key',
    );
    const runtimeEmbeddingApiKey =
      typeof runtime.openai_embedding_api_key === 'string'
        ? runtime.openai_embedding_api_key.trim()
        : '';
    const envEmbeddingApiKey = process.env.OPENAI_EMBEDDING_API_KEY?.trim() || '';

    const runtimeHasEmbeddingModel = Object.prototype.hasOwnProperty.call(
      runtime,
      'openai_embedding_model',
    );
    const runtimeEmbeddingModel =
      typeof runtime.openai_embedding_model === 'string'
        ? runtime.openai_embedding_model.trim()
        : '';
    const envEmbeddingModel = process.env.OPENAI_EMBEDDING_MODEL?.trim() || '';

    return {
      openaiBaseUrl: this.normalizeBaseUrl(
        runtime.openai_base_url || process.env.OPENAI_BASE_URL || this.defaultOpenAiBaseUrl,
      ),
      openaiApiKey: runtime.openai_api_key || process.env.OPENAI_API_KEY || '',
      openaiEmbeddingApiKey: runtimeHasEmbeddingApiKey
        ? runtimeEmbeddingApiKey
        : envEmbeddingApiKey,
      openaiModel: runtime.openai_model || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      openaiEmbeddingModel: runtimeHasEmbeddingModel
        ? runtimeEmbeddingModel
        : envEmbeddingModel || 'text-embedding-3-small',
      openaiInputPrice: typeof runtime.openai_input_price === 'number'
        ? runtime.openai_input_price
        : Number(process.env.OPENAI_INPUT_PRICE) || 0,
      openaiOutputPrice: typeof runtime.openai_output_price === 'number'
        ? runtime.openai_output_price
        : Number(process.env.OPENAI_OUTPUT_PRICE) || 0,
      webOrigin: runtime.web_origin || process.env.WEB_ORIGIN || 'http://localhost:3001',
    };
  }

  async getPublicConfig() {
    const runtime = await this.readRuntimeConfig();
    const ai = await this.getAiConfig();
    const chatKey = ai.openaiApiKey;
    const embeddingKey = ai.openaiEmbeddingApiKey;

    return {
      openai_base_url: ai.openaiBaseUrl,
      openai_api_key_configured: Boolean(chatKey),
      openai_api_key_preview: this.previewApiKey(chatKey),
      openai_embedding_api_key_configured: Boolean(embeddingKey),
      openai_embedding_api_key_preview: this.previewApiKey(embeddingKey),
      openai_model: ai.openaiModel,
      openai_embedding_model: ai.openaiEmbeddingModel,
      openai_input_price: ai.openaiInputPrice,
      openai_output_price: ai.openaiOutputPrice,
      web_origin: ai.webOrigin,
      source: {
        openai_base_url: runtime.openai_base_url
          ? 'runtime-config'
          : process.env.OPENAI_BASE_URL
            ? 'env'
            : 'default',
        openai_api_key: runtime.openai_api_key
          ? 'runtime-config'
          : process.env.OPENAI_API_KEY
            ? 'env'
            : 'unset',
        openai_embedding_api_key: Object.prototype.hasOwnProperty.call(
          runtime,
          'openai_embedding_api_key',
        )
          ? 'runtime-config'
          : process.env.OPENAI_EMBEDDING_API_KEY
            ? 'env'
            : 'unset',
        openai_model: runtime.openai_model
          ? 'runtime-config'
          : process.env.OPENAI_MODEL
            ? 'env'
            : 'default',
        openai_embedding_model: Object.prototype.hasOwnProperty.call(
          runtime,
          'openai_embedding_model',
        )
          ? 'runtime-config'
          : process.env.OPENAI_EMBEDDING_MODEL
            ? 'env'
            : 'default',
        openai_input_price: Object.prototype.hasOwnProperty.call(
          runtime,
          'openai_input_price',
        )
          ? 'runtime-config'
          : process.env.OPENAI_INPUT_PRICE
            ? 'env'
            : 'default',
        openai_output_price: Object.prototype.hasOwnProperty.call(
          runtime,
          'openai_output_price',
        )
          ? 'runtime-config'
          : process.env.OPENAI_OUTPUT_PRICE
            ? 'env'
            : 'default',
        web_origin: runtime.web_origin
          ? 'runtime-config'
          : process.env.WEB_ORIGIN
            ? 'env'
            : 'default',
      },
      updated_at: runtime.updated_at || null,
      config_file: this.configFile,
    };
  }

  async updateConfig(input: RuntimeConfig) {
    const current = await this.readRuntimeConfig();

    const next: RuntimeConfig = {
      ...current,
      updated_at: new Date().toISOString(),
    };

    if (typeof input.openai_base_url === 'string') {
      next.openai_base_url = this.normalizeBaseUrl(input.openai_base_url.trim());
    }
    if (typeof input.openai_api_key === 'string') {
      next.openai_api_key = input.openai_api_key.trim();
    }
    if (typeof input.openai_embedding_api_key === 'string') {
      next.openai_embedding_api_key = input.openai_embedding_api_key.trim();
    }
    if (typeof input.openai_model === 'string') {
      next.openai_model = input.openai_model.trim();
    }
    if (typeof input.openai_embedding_model === 'string') {
      next.openai_embedding_model = input.openai_embedding_model.trim();
    }
    if (typeof input.openai_input_price === 'number') {
      next.openai_input_price = input.openai_input_price;
    }
    if (typeof input.openai_output_price === 'number') {
      next.openai_output_price = input.openai_output_price;
    }
    if (typeof input.web_origin === 'string') {
      next.web_origin = input.web_origin.trim();
    }

    await this.writeRuntimeConfig(next);
    this.logger.log(`Runtime config updated: ${this.configFile}`);
    await this.serverLogService.info('admin.config.update', 'runtime config updated', {
      updated_fields: Object.keys(input),
    });

    return this.getPublicConfig();
  }

  async testAiConnectivity(overrides?: RuntimeConfig) {
    const current = await this.getAiConfig();
    const ai = {
      openaiBaseUrl:
        typeof overrides?.openai_base_url === 'string' &&
        overrides.openai_base_url.trim()
          ? this.normalizeBaseUrl(overrides.openai_base_url.trim())
          : current.openaiBaseUrl,
      openaiApiKey:
        typeof overrides?.openai_api_key === 'string'
          ? overrides.openai_api_key.trim()
          : current.openaiApiKey,
      openaiEmbeddingApiKey:
        typeof overrides?.openai_embedding_api_key === 'string'
          ? overrides.openai_embedding_api_key.trim()
          : current.openaiEmbeddingApiKey,
      openaiModel:
        typeof overrides?.openai_model === 'string' &&
        overrides.openai_model.trim()
          ? overrides.openai_model.trim()
          : current.openaiModel,
      openaiEmbeddingModel:
        typeof overrides?.openai_embedding_model === 'string' &&
        overrides.openai_embedding_model.trim()
          ? overrides.openai_embedding_model.trim()
          : current.openaiEmbeddingModel,
    };

    const result = {
      ok: false,
      message: '',
      base_url: ai.openaiBaseUrl,
      chat_model: ai.openaiModel,
      embedding_model: ai.openaiEmbeddingModel,
      chat: {
        ok: false,
        status: null as number | null,
        latency_ms: null as number | null,
        preview: '',
        error: null as string | null,
      },
      embedding: {
        ok: false,
        status: null as number | null,
        latency_ms: null as number | null,
        vector_size: null as number | null,
        error: null as string | null,
      },
    };

    if (!ai.openaiApiKey) {
      result.message = '未配置 API Key，请先在系统配置页保存后再测试。';
      return result;
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ai.openaiApiKey}`,
    };
    const chatEndpoint = this.getChatCompletionsUrl(ai.openaiBaseUrl);
    const embeddingEndpoint = this.getEmbeddingsUrl(ai.openaiBaseUrl);

    const chatStartedAt = Date.now();
    try {
      const response = await fetch(chatEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: ai.openaiModel,
          temperature: 0,
          max_tokens: 16,
          messages: [
            {
              role: 'system',
              content: '你是 有间 的接口连通性测试助手。',
            },
            {
              role: 'user',
              content: '请回复：连接正常',
            },
          ],
        }),
      });

      result.chat.status = response.status;
      result.chat.latency_ms = Date.now() - chatStartedAt;

      if (!response.ok) {
        const detail = await response.text();
        result.chat.error = this.clipError(detail);
      } else {
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        result.chat.ok = true;
        result.chat.preview = (
          payload.choices?.[0]?.message?.content?.trim() || '接口已返回响应。'
        ).slice(0, 120);
      }
    } catch (error) {
      result.chat.latency_ms = Date.now() - chatStartedAt;
      result.chat.error = this.clipError((error as Error).message || String(error));
    }

    const embeddingStartedAt = Date.now();
    if (!ai.openaiEmbeddingModel) {
      result.embedding.ok = false;
      result.embedding.error = '未配置 Embedding 模型，系统将使用本地降级向量。';
    } else if (!ai.openaiEmbeddingApiKey) {
      result.embedding.ok = false;
      result.embedding.error = '未配置 Embedding API Key，向量接口将跳过并回退本地向量。';
    } else {
      const embeddingHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.openaiEmbeddingApiKey}`,
      };
      try {
        const response = await fetch(embeddingEndpoint, {
          method: 'POST',
          headers: embeddingHeaders,
          body: JSON.stringify({
            model: ai.openaiEmbeddingModel,
            input: '有间 API connectivity check',
          }),
        });

        result.embedding.status = response.status;
        result.embedding.latency_ms = Date.now() - embeddingStartedAt;

        if (!response.ok) {
          const detail = await response.text();
          result.embedding.error = this.clipError(detail);
        } else {
          const payload = (await response.json()) as {
            data?: Array<{ embedding?: number[] }>;
          };
          const vector = payload.data?.[0]?.embedding;
          if (!Array.isArray(vector)) {
            result.embedding.error = '向量接口返回成功，但响应中没有 embedding 数组。';
          } else {
            result.embedding.ok = true;
            result.embedding.vector_size = vector.length;
          }
        }
      } catch (error) {
        result.embedding.latency_ms = Date.now() - embeddingStartedAt;
        result.embedding.error = this.clipError((error as Error).message || String(error));
      }
    }

    result.ok = result.chat.ok;
    if (result.chat.ok && result.embedding.ok) {
      result.message = '聊天接口与向量接口均可用。';
    } else if (result.chat.ok) {
      result.message = '聊天接口可用，向量接口不可用时系统会自动降级为本地向量。';
    } else {
      result.message = '聊天接口测试失败，请检查 Base URL、API Key 与模型名称。';
    }

    if (result.ok) {
      await this.serverLogService.info('admin.config.test', 'ai connectivity test passed', {
        base_url: result.base_url,
        chat_model: result.chat_model,
        embedding_model: result.embedding_model,
        chat_latency_ms: result.chat.latency_ms,
        embedding_latency_ms: result.embedding.latency_ms,
        has_override: Boolean(overrides && Object.keys(overrides).length > 0),
      });
    } else {
      await this.serverLogService.warn('admin.config.test', 'ai connectivity test failed', {
        base_url: result.base_url,
        chat_error: result.chat.error,
        embedding_error: result.embedding.error,
        has_override: Boolean(overrides && Object.keys(overrides).length > 0),
      });
    }

    return result;
  }

  private async ensureConfigFile() {
    await fs.mkdir(this.configDir, { recursive: true });
    try {
      await fs.access(this.configFile);
    } catch {
      const initial: RuntimeConfig = {
        updated_at: new Date().toISOString(),
      };
      await fs.writeFile(this.configFile, JSON.stringify(initial, null, 2), 'utf8');
    }
  }

  private async readRuntimeConfig(): Promise<RuntimeConfig> {
    await this.ensureConfigFile();
    try {
      const raw = await fs.readFile(this.configFile, 'utf8');
      const parsed = JSON.parse(raw) as RuntimeConfig;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      return parsed;
    } catch (error) {
      this.logger.warn(
        `Failed to read runtime config, fallback to env: ${(error as Error).message}`,
      );
      return {};
    }
  }

  private async writeRuntimeConfig(config: RuntimeConfig) {
    await this.ensureConfigFile();
    await fs.writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf8');
  }

  private normalizeBaseUrl(baseUrl: string) {
    const normalized = baseUrl.trim();
    if (!normalized) {
      return this.defaultOpenAiBaseUrl;
    }
    return normalized.replace(/\/+$/, '');
  }

  getChatCompletionsUrl(baseUrl: string) {
    return this.resolveEndpoint(baseUrl, 'chat');
  }

  getEmbeddingsUrl(baseUrl: string) {
    return this.resolveEndpoint(baseUrl, 'embedding');
  }

  private resolveEndpoint(baseUrl: string, type: 'chat' | 'embedding') {
    const normalized = this.normalizeBaseUrl(baseUrl);

    if (type === 'chat') {
      if (/\/chat\/completions$/i.test(normalized)) {
        return normalized;
      }
      if (/\/embeddings$/i.test(normalized)) {
        return normalized.replace(/\/embeddings$/i, '/chat/completions');
      }
      return `${normalized}/chat/completions`;
    }

    if (/\/embeddings$/i.test(normalized)) {
      return normalized;
    }
    if (/\/chat\/completions$/i.test(normalized)) {
      return normalized.replace(/\/chat\/completions$/i, '/embeddings');
    }
    return `${normalized}/embeddings`;
  }

  private clipError(raw: string) {
    return (raw || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  private previewApiKey(key: string) {
    if (!key) {
      return null;
    }
    return `${key.slice(0, 3)}***${key.slice(Math.max(3, key.length - 4))}`;
  }
}

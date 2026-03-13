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

    return {
      openaiBaseUrl: this.normalizeBaseUrl(
        runtime.openai_base_url || process.env.OPENAI_BASE_URL || this.defaultOpenAiBaseUrl,
      ),
      openaiApiKey: runtime.openai_api_key || process.env.OPENAI_API_KEY || '',
      openaiModel: runtime.openai_model || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      openaiEmbeddingModel:
        runtime.openai_embedding_model ||
        process.env.OPENAI_EMBEDDING_MODEL ||
        'text-embedding-3-small',
      webOrigin: runtime.web_origin || process.env.WEB_ORIGIN || 'http://localhost:3001',
    };
  }

  async getPublicConfig() {
    const runtime = await this.readRuntimeConfig();
    const ai = await this.getAiConfig();
    const key = ai.openaiApiKey;

    return {
      openai_base_url: ai.openaiBaseUrl,
      openai_api_key_configured: Boolean(key),
      openai_api_key_preview: key
        ? `${key.slice(0, 3)}***${key.slice(Math.max(3, key.length - 4))}`
        : null,
      openai_model: ai.openaiModel,
      openai_embedding_model: ai.openaiEmbeddingModel,
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
        openai_model: runtime.openai_model
          ? 'runtime-config'
          : process.env.OPENAI_MODEL
            ? 'env'
            : 'default',
        openai_embedding_model: runtime.openai_embedding_model
          ? 'runtime-config'
          : process.env.OPENAI_EMBEDDING_MODEL
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
    if (typeof input.openai_model === 'string') {
      next.openai_model = input.openai_model.trim();
    }
    if (typeof input.openai_embedding_model === 'string') {
      next.openai_embedding_model = input.openai_embedding_model.trim();
    }
    if (typeof input.web_origin === 'string') {
      next.web_origin = input.web_origin.trim();
    }

    await this.writeRuntimeConfig(next);
    this.logger.log(`Runtime config updated: ${this.configFile}`);
    await this.serverLogService.info(
      'admin.config.update',
      'runtime config updated',
      { updated_fields: Object.keys(input) },
    );

    return this.getPublicConfig();
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
}

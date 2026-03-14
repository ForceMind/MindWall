"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var AdminConfigService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminConfigService = void 0;
const common_1 = require("@nestjs/common");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const server_log_service_1 = require("../telemetry/server-log.service");
let AdminConfigService = AdminConfigService_1 = class AdminConfigService {
    serverLogService;
    logger = new common_1.Logger(AdminConfigService_1.name);
    configDir = path_1.default.join(process.cwd(), 'config');
    configFile = path_1.default.join(this.configDir, 'runtime-config.json');
    defaultOpenAiBaseUrl = 'https://api.openai.com/v1';
    constructor(serverLogService) {
        this.serverLogService = serverLogService;
    }
    async getAiConfig() {
        const runtime = await this.readRuntimeConfig();
        return {
            openaiBaseUrl: this.normalizeBaseUrl(runtime.openai_base_url || process.env.OPENAI_BASE_URL || this.defaultOpenAiBaseUrl),
            openaiApiKey: runtime.openai_api_key || process.env.OPENAI_API_KEY || '',
            openaiModel: runtime.openai_model || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
            openaiEmbeddingModel: runtime.openai_embedding_model ||
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
    async updateConfig(input) {
        const current = await this.readRuntimeConfig();
        const next = {
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
        await this.serverLogService.info('admin.config.update', 'runtime config updated', {
            updated_fields: Object.keys(input),
        });
        return this.getPublicConfig();
    }
    async testAiConnectivity(overrides) {
        const current = await this.getAiConfig();
        const ai = {
            openaiBaseUrl: typeof overrides?.openai_base_url === 'string' &&
                overrides.openai_base_url.trim()
                ? this.normalizeBaseUrl(overrides.openai_base_url.trim())
                : current.openaiBaseUrl,
            openaiApiKey: typeof overrides?.openai_api_key === 'string'
                ? overrides.openai_api_key.trim()
                : current.openaiApiKey,
            openaiModel: typeof overrides?.openai_model === 'string' &&
                overrides.openai_model.trim()
                ? overrides.openai_model.trim()
                : current.openaiModel,
            openaiEmbeddingModel: typeof overrides?.openai_embedding_model === 'string' &&
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
                status: null,
                latency_ms: null,
                preview: '',
                error: null,
            },
            embedding: {
                ok: false,
                status: null,
                latency_ms: null,
                vector_size: null,
                error: null,
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
        const chatStartedAt = Date.now();
        try {
            const response = await fetch(`${ai.openaiBaseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: ai.openaiModel,
                    temperature: 0,
                    max_tokens: 16,
                    messages: [
                        {
                            role: 'system',
                            content: '你是 MindWall 的接口连通性测试助手。',
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
            }
            else {
                const payload = (await response.json());
                result.chat.ok = true;
                result.chat.preview = (payload.choices?.[0]?.message?.content?.trim() || '接口已返回响应。').slice(0, 120);
            }
        }
        catch (error) {
            result.chat.latency_ms = Date.now() - chatStartedAt;
            result.chat.error = this.clipError(error.message || String(error));
        }
        const embeddingStartedAt = Date.now();
        try {
            const response = await fetch(`${ai.openaiBaseUrl}/embeddings`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: ai.openaiEmbeddingModel,
                    input: 'MindWall API connectivity check',
                }),
            });
            result.embedding.status = response.status;
            result.embedding.latency_ms = Date.now() - embeddingStartedAt;
            if (!response.ok) {
                const detail = await response.text();
                result.embedding.error = this.clipError(detail);
            }
            else {
                const payload = (await response.json());
                const vector = payload.data?.[0]?.embedding;
                if (!Array.isArray(vector)) {
                    result.embedding.error = '向量接口返回成功，但响应中没有 embedding 数组。';
                }
                else {
                    result.embedding.ok = true;
                    result.embedding.vector_size = vector.length;
                }
            }
        }
        catch (error) {
            result.embedding.latency_ms = Date.now() - embeddingStartedAt;
            result.embedding.error = this.clipError(error.message || String(error));
        }
        result.ok = result.chat.ok && result.embedding.ok;
        result.message = result.ok
            ? '聊天接口与向量接口均可用。'
            : '至少一个接口测试失败，请检查接口地址、API Key 与模型名称。';
        if (result.ok) {
            await this.serverLogService.info('admin.config.test', 'ai connectivity test passed', {
                base_url: result.base_url,
                chat_model: result.chat_model,
                embedding_model: result.embedding_model,
                chat_latency_ms: result.chat.latency_ms,
                embedding_latency_ms: result.embedding.latency_ms,
                has_override: Boolean(overrides && Object.keys(overrides).length > 0),
            });
        }
        else {
            await this.serverLogService.warn('admin.config.test', 'ai connectivity test failed', {
                base_url: result.base_url,
                chat_error: result.chat.error,
                embedding_error: result.embedding.error,
                has_override: Boolean(overrides && Object.keys(overrides).length > 0),
            });
        }
        return result;
    }
    async ensureConfigFile() {
        await fs_1.promises.mkdir(this.configDir, { recursive: true });
        try {
            await fs_1.promises.access(this.configFile);
        }
        catch {
            const initial = {
                updated_at: new Date().toISOString(),
            };
            await fs_1.promises.writeFile(this.configFile, JSON.stringify(initial, null, 2), 'utf8');
        }
    }
    async readRuntimeConfig() {
        await this.ensureConfigFile();
        try {
            const raw = await fs_1.promises.readFile(this.configFile, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return {};
            }
            return parsed;
        }
        catch (error) {
            this.logger.warn(`Failed to read runtime config, fallback to env: ${error.message}`);
            return {};
        }
    }
    async writeRuntimeConfig(config) {
        await this.ensureConfigFile();
        await fs_1.promises.writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf8');
    }
    normalizeBaseUrl(baseUrl) {
        const normalized = baseUrl.trim();
        if (!normalized) {
            return this.defaultOpenAiBaseUrl;
        }
        return normalized.replace(/\/+$/, '');
    }
    clipError(raw) {
        return (raw || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    }
};
exports.AdminConfigService = AdminConfigService;
exports.AdminConfigService = AdminConfigService = AdminConfigService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_log_service_1.ServerLogService])
], AdminConfigService);
//# sourceMappingURL=admin-config.service.js.map
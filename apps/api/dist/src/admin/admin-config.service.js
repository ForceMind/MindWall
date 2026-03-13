"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
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
let AdminConfigService = AdminConfigService_1 = class AdminConfigService {
    logger = new common_1.Logger(AdminConfigService_1.name);
    configDir = path_1.default.join(process.cwd(), 'config');
    configFile = path_1.default.join(this.configDir, 'runtime-config.json');
    defaultOpenAiBaseUrl = 'https://api.openai.com/v1';
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
        return this.getPublicConfig();
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
};
exports.AdminConfigService = AdminConfigService;
exports.AdminConfigService = AdminConfigService = AdminConfigService_1 = __decorate([
    (0, common_1.Injectable)()
], AdminConfigService);
//# sourceMappingURL=admin-config.service.js.map
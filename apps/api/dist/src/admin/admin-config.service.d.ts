import { ServerLogService } from '../telemetry/server-log.service';
import { AiRuntimeConfig, RuntimeConfig } from './admin.types';
export declare class AdminConfigService {
    private readonly serverLogService;
    private readonly logger;
    private readonly configDir;
    private readonly configFile;
    private readonly defaultOpenAiBaseUrl;
    constructor(serverLogService: ServerLogService);
    getAiConfig(): Promise<AiRuntimeConfig>;
    getPublicConfig(): Promise<{
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
    }>;
    updateConfig(input: RuntimeConfig): Promise<{
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
    }>;
    testAiConnectivity(overrides?: RuntimeConfig): Promise<{
        ok: boolean;
        message: string;
        base_url: string;
        chat_model: string;
        embedding_model: string;
        chat: {
            ok: boolean;
            status: number | null;
            latency_ms: number | null;
            preview: string;
            error: string | null;
        };
        embedding: {
            ok: boolean;
            status: number | null;
            latency_ms: number | null;
            vector_size: number | null;
            error: string | null;
        };
    }>;
    private ensureConfigFile;
    private readRuntimeConfig;
    private writeRuntimeConfig;
    private normalizeBaseUrl;
    private clipError;
}

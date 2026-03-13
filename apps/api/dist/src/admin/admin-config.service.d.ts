import { AiRuntimeConfig, RuntimeConfig } from './admin.types';
export declare class AdminConfigService {
    private readonly logger;
    private readonly configDir;
    private readonly configFile;
    private readonly defaultOpenAiBaseUrl;
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
    private ensureConfigFile;
    private readRuntimeConfig;
    private writeRuntimeConfig;
    private normalizeBaseUrl;
}

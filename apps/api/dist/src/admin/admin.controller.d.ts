import { AdminConfigService } from './admin-config.service';
export declare class AdminController {
    private readonly adminConfigService;
    constructor(adminConfigService: AdminConfigService);
    getConfig(): Promise<{
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
    updateConfig(body: Record<string, unknown>): Promise<{
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
    testConfig(body: Record<string, unknown>): Promise<{
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
}

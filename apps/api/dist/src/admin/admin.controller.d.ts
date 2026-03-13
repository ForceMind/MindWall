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
}

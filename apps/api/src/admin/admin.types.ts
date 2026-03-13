export interface RuntimeConfig {
  openai_base_url?: string;
  openai_api_key?: string;
  openai_model?: string;
  openai_embedding_model?: string;
  web_origin?: string;
  updated_at?: string;
}

export interface AiRuntimeConfig {
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiEmbeddingModel: string;
  webOrigin: string;
}

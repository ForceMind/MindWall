export interface RuntimeConfig {
  openai_base_url?: string;
  openai_api_key?: string;
  openai_embedding_api_key?: string;
  openai_model?: string;
  openai_embedding_model?: string;
  openai_input_price?: number;
  openai_output_price?: number;
  web_origin?: string;
  updated_at?: string;
}

export interface AiRuntimeConfig {
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiEmbeddingApiKey: string;
  openaiModel: string;
  openaiEmbeddingModel: string;
  openaiInputPrice: number;
  openaiOutputPrice: number;
  webOrigin: string;
}

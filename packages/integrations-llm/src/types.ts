export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 'small' = classificazione/routing rapido | 'medium' = drafting | 'large' = reasoning complesso */
export type ModelTier = 'small' | 'medium' | 'large';

export interface LLMOptions {
  model?: string;
  tier?: ModelTier;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  tokensUsed?: number;
}

export interface LLMClient {
  chat(messages: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse>;
  readonly provider: string;
  readonly model: string;
}

/** Configurazione provider LLM — definita qui, riusata da shared-config */
export interface LLMClientConfig {
  primary: 'ollama' | 'openai' | 'anthropic' | 'deepseek';
  fallback?: 'openai' | 'anthropic' | 'deepseek';

  // Ollama
  ollamaUrl: string;
  ollamaModelSmall: string;   // es. gemma3:12b   — task veloci
  ollamaModelMedium: string;  // es. gpt-oss:20b  — drafting
  ollamaModelLarge: string;   // es. gemma3:27b   — reasoning/proposta

  // OpenAI
  openaiApiKey?: string;
  openaiModelSmall: string;
  openaiModelMedium: string;
  openaiModelLarge: string;

  // Anthropic
  anthropicApiKey?: string;
  anthropicModelSmall: string;
  anthropicModelLarge: string;

  // DeepSeek
  deepseekApiKey?: string;
  deepseekApiUrl: string;     // es. https://api.deepseek.com/v1
  deepseekModelSmall: string;
  deepseekModelMedium: string;
  deepseekModelLarge: string;
}

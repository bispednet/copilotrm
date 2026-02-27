export type { LLMClient, LLMClientConfig, LLMMessage, LLMOptions, LLMResponse, ModelTier } from './types.js';
export { createLLMClient } from './client.js';
export { createOllamaClient } from './providers/ollama.js';
export { createOpenAIClient } from './providers/openai.js';
export { createAnthropicClient } from './providers/anthropic.js';
export type { EmbeddingClient } from './embedding.js';
export {
  createOllamaEmbeddingClient,
  createOpenAIEmbeddingClient,
  createEmbeddingClient,
  cosineSimilarity,
} from './embedding.js';

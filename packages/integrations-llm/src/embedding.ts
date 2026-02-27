import type { LLMClientConfig } from './types.js';

export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
}

/** Embedding via Ollama /api/embeddings (es. mxbai-embed-large = 1024d) */
export function createOllamaEmbeddingClient(config: {
  baseUrl?: string;
  model: string;
  timeoutMs?: number;
}): EmbeddingClient {
  const baseUrl = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  const timeoutMs = config.timeoutMs ?? 30_000;

  // dimensioni note; default generico se modello sconosciuto
  const KNOWN_DIMS: Record<string, number> = {
    'mxbai-embed-large': 1024,
    'nomic-embed-text': 768,
    'all-minilm': 384,
    'snowflake-arctic-embed': 1024,
  };
  const dims = KNOWN_DIMS[config.model] ?? 768;

  return {
    provider: 'ollama',
    model: config.model,
    dimensions: dims,

    async embed(text: string): Promise<number[]> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/api/embeddings`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.model, prompt: text }),
        });
        if (!res.ok) {
          const err = await res.text().catch(() => res.statusText);
          throw new Error(`ollama embed error ${res.status}: ${err}`);
        }
        const data = (await res.json()) as { embedding: number[] };
        return data.embedding;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Embedding via OpenAI text-embedding-3-small/large */
export function createOpenAIEmbeddingClient(config: {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}): EmbeddingClient {
  const model = config.model ?? 'text-embedding-3-small';
  const timeoutMs = config.timeoutMs ?? 15_000;
  const DIMS: Record<string, number> = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
  };

  return {
    provider: 'openai',
    model,
    dimensions: DIMS[model] ?? 1536,

    async embed(text: string): Promise<number[]> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({ model, input: text }),
        });
        if (!res.ok) {
          const err = await res.text().catch(() => res.statusText);
          throw new Error(`openai embed error ${res.status}: ${err}`);
        }
        const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
        return data.data[0]?.embedding ?? [];
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Cosine similarity tra due vettori */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Crea un EmbeddingClient dalla config LLM.
 * Usa Ollama se USE_OLLAMA_EMBEDDING=true, altrimenti OpenAI se OPENAI_API_KEY presente.
 * Ritorna null se nessun provider disponibile.
 */
export function createEmbeddingClient(
  cfg: LLMClientConfig,
  env?: Record<string, string | undefined>
): EmbeddingClient | null {
  const useOllama =
    (env?.USE_OLLAMA_EMBEDDING ?? '').toLowerCase() === 'true' ||
    cfg.primary === 'ollama';

  if (useOllama) {
    const model = env?.OLLAMA_EMBEDDING_MODEL ?? 'mxbai-embed-large';
    return createOllamaEmbeddingClient({ baseUrl: cfg.ollamaUrl, model });
  }

  const openaiKey = env?.OPENAI_API_KEY ?? cfg.openaiApiKey;
  if (openaiKey) {
    const model = env?.EMBEDDING_OPENAI_MODEL ?? 'text-embedding-3-small';
    return createOpenAIEmbeddingClient({ apiKey: openaiKey, model });
  }

  // Fallback: Ollama anche senza USE_OLLAMA_EMBEDDING, se è il provider primario
  if (cfg.primary === 'ollama') {
    return createOllamaEmbeddingClient({
      baseUrl: cfg.ollamaUrl,
      model: env?.OLLAMA_EMBEDDING_MODEL ?? 'mxbai-embed-large',
    });
  }

  return null;
}

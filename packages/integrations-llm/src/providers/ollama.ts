import type { LLMClient, LLMMessage, LLMOptions, LLMResponse } from '../types.js';

export interface OllamaProviderConfig {
  baseUrl?: string;
  model: string;
  timeoutMs?: number;
}

export function createOllamaClient(config: OllamaProviderConfig): LLMClient {
  const baseUrl = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  // Timeout generoso per Ollama locale (modelli grandi possono essere lenti)
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    provider: 'ollama',
    model: config.model,

    async chat(messages: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
      const model = opts?.model ?? config.model;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: {
              temperature: opts?.temperature ?? 0.7,
              num_predict: opts?.maxTokens ?? 1024,
            },
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`ollama API error ${res.status}: ${errText}`);
        }
        const data = (await res.json()) as {
          message?: { content: string };
          eval_count?: number;
          model?: string;
        };
        return {
          content: data.message?.content ?? '',
          provider: 'ollama',
          model: data.model ?? model,
          tokensUsed: data.eval_count,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

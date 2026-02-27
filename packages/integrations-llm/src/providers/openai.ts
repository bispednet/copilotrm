import type { LLMClient, LLMMessage, LLMOptions, LLMResponse } from '../types.js';

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  providerName?: string;
  timeoutMs?: number;
}

export function createOpenAIClient(config: OpenAIProviderConfig): LLMClient {
  const baseUrl = (config.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
  const providerName = config.providerName ?? 'openai';
  const timeoutMs = config.timeoutMs ?? 15_000;

  return {
    provider: providerName,
    model: config.model,

    async chat(messages: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
      const model = opts?.model ?? config.model;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: opts?.maxTokens ?? 1024,
            temperature: opts?.temperature ?? 0.7,
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`${providerName} API error ${res.status}: ${errText}`);
        }
        const data = (await res.json()) as {
          choices: Array<{ message: { content: string } }>;
          usage?: { total_tokens?: number };
          model: string;
        };
        return {
          content: data.choices[0]?.message?.content ?? '',
          provider: providerName,
          model: data.model ?? model,
          tokensUsed: data.usage?.total_tokens,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

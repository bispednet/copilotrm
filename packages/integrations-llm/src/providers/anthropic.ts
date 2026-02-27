import type { LLMClient, LLMMessage, LLMOptions, LLMResponse } from '../types.js';

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export function createAnthropicClient(config: AnthropicProviderConfig): LLMClient {
  const timeoutMs = config.timeoutMs ?? 15_000;

  return {
    provider: 'anthropic',
    model: config.model,

    async chat(messages: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
      const model = opts?.model ?? config.model;
      // Anthropic separa il system message dagli user/assistant messages
      const systemMsg = messages.find((m) => m.role === 'system');
      const userMsgs = messages.filter((m) => m.role !== 'system');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: opts?.maxTokens ?? 1024,
            ...(systemMsg ? { system: systemMsg.content } : {}),
            messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`anthropic API error ${res.status}: ${errText}`);
        }
        const data = (await res.json()) as {
          content: Array<{ type: string; text: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
          model: string;
        };
        const text = data.content.find((c) => c.type === 'text')?.text ?? '';
        return {
          content: text,
          provider: 'anthropic',
          model: data.model ?? model,
          tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

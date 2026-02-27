import { createAnthropicClient } from './providers/anthropic.js';
import { createOpenAIClient } from './providers/openai.js';
import { createOllamaClient } from './providers/ollama.js';
import type { LLMClient, LLMClientConfig, LLMMessage, LLMOptions, LLMResponse, ModelTier } from './types.js';

type FallbackProvider = NonNullable<LLMClientConfig['fallback']>;

/** Seleziona il modello giusto per il tier richiesto */
function pickModel(
  provider: LLMClientConfig['primary'] | FallbackProvider,
  cfg: LLMClientConfig,
  tier: ModelTier = 'large'
): string {
  switch (provider) {
    case 'ollama':
      return tier === 'small' ? cfg.ollamaModelSmall : tier === 'medium' ? cfg.ollamaModelMedium : cfg.ollamaModelLarge;
    case 'openai':
      return tier === 'small' ? cfg.openaiModelSmall : tier === 'medium' ? cfg.openaiModelMedium : cfg.openaiModelLarge;
    case 'anthropic':
      return tier === 'small' ? cfg.anthropicModelSmall : cfg.anthropicModelLarge;
    case 'deepseek':
      return tier === 'small' ? cfg.deepseekModelSmall : tier === 'medium' ? cfg.deepseekModelMedium : cfg.deepseekModelLarge;
    default:
      return 'unknown';
  }
}

function buildClient(
  name: LLMClientConfig['primary'] | FallbackProvider,
  cfg: LLMClientConfig
): LLMClient | null {
  switch (name) {
    case 'ollama':
      // modello default = large; il tier viene risolto in chat() via opts.model
      return createOllamaClient({ baseUrl: cfg.ollamaUrl, model: cfg.ollamaModelLarge });
    case 'openai':
      if (!cfg.openaiApiKey) return null;
      return createOpenAIClient({ apiKey: cfg.openaiApiKey, model: cfg.openaiModelLarge });
    case 'anthropic':
      if (!cfg.anthropicApiKey) return null;
      return createAnthropicClient({ apiKey: cfg.anthropicApiKey, model: cfg.anthropicModelLarge });
    case 'deepseek':
      if (!cfg.deepseekApiKey) return null;
      return createOpenAIClient({
        apiKey: cfg.deepseekApiKey,
        baseUrl: cfg.deepseekApiUrl.replace(/\/v1\/?$/, ''), // normalizza — provider aggiunge /v1
        model: cfg.deepseekModelLarge,
        providerName: 'deepseek',
      });
    default:
      return null;
  }
}

/** Errori che giustificano un retry sul provider di fallback */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('fetch failed') ||
    msg.includes('aborted') ||
    msg.includes('network') ||
    /api error 5\d\d/.test(msg) ||
    /api error 429/.test(msg)
  );
}

/**
 * Crea un LLMClient con strategia local-first + cloud fallback.
 * Supporta tier small/medium/large: passa opts.tier per scegliere il modello.
 * Se il provider primario fallisce con errore retryable, tenta il fallback.
 */
export function createLLMClient(cfg: LLMClientConfig): LLMClient {
  const primaryName = cfg.primary;
  const primary = buildClient(primaryName, cfg);
  const fallback = cfg.fallback ? buildClient(cfg.fallback, cfg) : null;

  const effectivePrimary = primary ?? fallback;
  const effectiveName = primary ? primaryName : cfg.fallback;

  return {
    provider: effectivePrimary?.provider ?? 'none',
    model: effectivePrimary?.model ?? 'none',

    async chat(messages: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
      // Risolve il modello in base al tier se non specificato esplicitamente
      const tier = opts?.tier ?? 'large';
      const resolvedOpts: LLMOptions = {
        ...opts,
        model: opts?.model ?? (effectiveName ? pickModel(effectiveName, cfg, tier) : undefined),
      };

      if (primary) {
        const primaryOpts: LLMOptions = {
          ...opts,
          model: opts?.model ?? pickModel(primaryName, cfg, tier),
        };
        try {
          return await primary.chat(messages, primaryOpts);
        } catch (err) {
          if (fallback && isRetryable(err)) {
            return await fallback.chat(messages, resolvedOpts);
          }
          throw err;
        }
      }
      if (fallback) {
        return await fallback.chat(messages, resolvedOpts);
      }
      throw new Error('Nessun provider LLM configurato');
    },
  };
}

import type { LLMClientConfig } from '@bisp/integrations-llm';

export type { LLMClientConfig };

export interface AppConfig {
  apiPort: number;
  dbUrl: string;
  redisUrl: string;
  /** @deprecated usa llm.primary */
  llmProvider: 'local' | 'api';
  llm: LLMClientConfig;
}

/** Legge una variabile env provando più nomi (primo non-vuoto vince) */
function pick(env: Record<string, string | undefined>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = env[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

export function loadConfig(
  env: Record<string, string | undefined> = (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  )
): AppConfig {
  const primary = (pick(env, 'LLM_PROVIDER') ?? 'ollama') as LLMClientConfig['primary'];
  const fallback = pick(env, 'LLM_FALLBACK_PROVIDER') as LLMClientConfig['fallback'] | undefined;

  return {
    apiPort: Number(env.PORT_API_CORE ?? 4010),
    dbUrl: env.DATABASE_URL ?? 'postgres://localhost:5432/copilotrm',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    llmProvider: primary === 'ollama' ? 'local' : 'api',
    llm: {
      primary,
      fallback,

      // ── Ollama ──────────────────────────────────────────────────────────────
      ollamaUrl: pick(env, 'OLLAMA_SERVER_URL') ?? 'http://localhost:11434',
      // Naming convention Eliza: SMALL_OLLAMA_MODEL | alias CopilotRM: OLLAMA_MODEL_SMALL
      ollamaModelSmall:
        pick(env, 'SMALL_OLLAMA_MODEL', 'OLLAMA_MODEL_SMALL') ?? 'gemma3:12b',
      ollamaModelMedium:
        pick(env, 'MEDIUM_OLLAMA_MODEL', 'OLLAMA_MODEL_MEDIUM') ?? 'gemma3:12b',
      // LARGE o OLLAMA_MODEL (nome base del repo Eliza) o alias CopilotRM
      ollamaModelLarge:
        pick(env, 'LARGE_OLLAMA_MODEL', 'OLLAMA_MODEL', 'OLLAMA_MODEL_LARGE', 'OLLAMA_MODEL_CHAT') ?? 'gemma3:27b',

      // ── OpenAI ──────────────────────────────────────────────────────────────
      openaiApiKey: pick(env, 'OPENAI_API_KEY'),
      openaiModelSmall:
        pick(env, 'SMALL_OPENAI_MODEL', 'OPENAI_MODEL_SMALL') ?? 'gpt-4.1-mini',
      openaiModelMedium:
        pick(env, 'MEDIUM_OPENAI_MODEL', 'OPENAI_MODEL_MEDIUM') ?? 'gpt-4.1-mini',
      openaiModelLarge:
        pick(env, 'LARGE_OPENAI_MODEL', 'OPENAI_MODEL_LARGE', 'OPENAI_MODEL_CHAT') ?? 'gpt-4.1',

      // ── Anthropic ───────────────────────────────────────────────────────────
      anthropicApiKey: pick(env, 'ANTHROPIC_API_KEY'),
      anthropicModelSmall:
        pick(env, 'ANTHROPIC_MODEL_SMALL') ?? 'claude-haiku-4-5-20251001',
      anthropicModelLarge:
        pick(env, 'ANTHROPIC_MODEL_LARGE', 'ANTHROPIC_MODEL_CHAT') ?? 'claude-sonnet-4-6',

      // ── DeepSeek ────────────────────────────────────────────────────────────
      deepseekApiKey: pick(env, 'DEEPSEEK_API_KEY'),
      deepseekApiUrl: pick(env, 'DEEPSEEK_API_URL') ?? 'https://api.deepseek.com',
      deepseekModelSmall:
        pick(env, 'SMALL_DEEPSEEK_MODEL', 'DEEPSEEK_MODEL_SMALL') ?? 'deepseek-chat',
      deepseekModelMedium:
        pick(env, 'MEDIUM_DEEPSEEK_MODEL', 'DEEPSEEK_MODEL_MEDIUM') ?? 'deepseek-chat',
      deepseekModelLarge:
        pick(env, 'LARGE_DEEPSEEK_MODEL', 'DEEPSEEK_MODEL_LARGE', 'DEEPSEEK_MODEL_CHAT') ?? 'deepseek-chat',
    },
  };
}

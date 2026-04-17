import type { LLMClientConfig } from '@bisp/integrations-llm';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type { LLMClientConfig };

export interface AppConfig {
  apiPort: number;
  dbUrl: string;
  redisUrl: string;
  rootDir: string;
  migrationsDir: string;
  dataDir: string;
  channelGatewayUrl: string;
  channelGatewayTimeoutMs: number;
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

function readBoolean(env: Record<string, string | undefined>, fallback: boolean, ...keys: string[]): boolean {
  const value = pick(env, ...keys);
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readNumber(env: Record<string, string | undefined>, fallback: number, ...keys: string[]): number {
  const value = Number(pick(env, ...keys));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveDefaultChromePath(): string | undefined {
  const candidates = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'];
  return candidates.find((candidate) => existsSync(candidate));
}

function resolveProfileNamespace(browserChannel?: string, executablePath?: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (executablePath?.includes('google-chrome')) return 'chrome-stable';
  if (browserChannel) return browserChannel;
  return 'chromium';
}

export function loadConfig(
  env: Record<string, string | undefined> = (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  )
): AppConfig {
  const runtimeProcess = (globalThis as { process?: { cwd?: () => string } }).process;
  const rootDir = pick(env, 'BISPCRM_ROOT_DIR') ?? runtimeProcess?.cwd?.() ?? '.';
  const migrationsDir = pick(env, 'BISPCRM_MIGRATIONS_DIR') ?? `${rootDir}/infra/migrations`;
  const dataDir = pick(env, 'BISPCRM_RUNTIME_DATA_DIR', 'COPILOTRM_DATA_DIR') ?? `${rootDir}/data`;
  const channelGatewayUrl = pick(env, 'BISPCRM_CHANNEL_GATEWAY_URL') ?? `http://localhost:${env.PORT_GATEWAY_CHANNELS ?? 4020}`;
  const channelGatewayTimeoutMs = Number(pick(env, 'BISPCRM_CHANNEL_GATEWAY_TIMEOUT_MS') ?? 5000);
  const primary = (pick(env, 'LLM_PROVIDER') ?? 'ollama') as LLMClientConfig['primary'];
  const fallback = pick(env, 'LLM_FALLBACK_PROVIDER') as LLMClientConfig['fallback'] | undefined;
  const browserChannel = pick(env, 'PLAYWRIGHT_BROWSER_CHANNEL');
  const browserExecutablePath = pick(env, 'PLAYWRIGHT_EXECUTABLE_PATH') ?? resolveDefaultChromePath();
  const profileNamespace = resolveProfileNamespace(
    browserChannel,
    browserExecutablePath,
    pick(env, 'PLAYWRIGHT_PROFILE_NAMESPACE'),
  );
  const defaultProfileDir = path.resolve(rootDir, '.playwright/profiles');

  return {
    apiPort: Number(env.PORT_API_CORE ?? 4010),
    dbUrl: env.DATABASE_URL ?? 'postgres://copilotrm:copilotrm_dev_pwd@localhost:5432/copilotrm',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    rootDir,
    migrationsDir,
    dataDir,
    channelGatewayUrl,
    channelGatewayTimeoutMs: Number.isFinite(channelGatewayTimeoutMs) && channelGatewayTimeoutMs > 0 ? channelGatewayTimeoutMs : 5000,
    llmProvider: primary === 'ollama' || primary === 'tegem' ? 'local' : 'api',
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

      // ── TeGem / Gemini via Playwright ─────────────────────────────────────
      tegemBaseUrl: pick(env, 'TEGEM_BASE_URL') ?? 'https://gemini.google.com/app',
      tegemHeadless: readBoolean(env, false, 'PLAYWRIGHT_HEADLESS', 'TEGEM_HEADLESS'),
      tegemBrowserChannel: browserChannel,
      tegemBrowserExecutablePath: browserExecutablePath,
      tegemBaseProfileDir:
        path.resolve(rootDir, pick(env, 'PLAYWRIGHT_BASE_PROFILE_DIR', 'TEGEM_BASE_PROFILE_DIR') ?? defaultProfileDir),
      tegemProfileNamespace: profileNamespace,
      tegemSessionIdleTimeoutMs: readNumber(env, 30 * 60_000, 'SESSION_IDLE_TIMEOUT_MS', 'TEGEM_SESSION_IDLE_TIMEOUT_MS'),
      tegemConversationTtlMs: readNumber(env, 24 * 60 * 60_000, 'SESSION_CONVERSATION_TTL_MS', 'TEGEM_SESSION_CONVERSATION_TTL_MS'),
      tegemMaxSessionTabs: readNumber(env, 20, 'MAX_SESSION_TABS', 'TEGEM_MAX_SESSION_TABS'),
      tegemStreamPollIntervalMs: readNumber(env, 700, 'STREAM_POLL_INTERVAL_MS', 'TEGEM_STREAM_POLL_INTERVAL_MS'),
      tegemStreamStableTicks: readNumber(env, 4, 'STREAM_STABLE_TICKS', 'TEGEM_STREAM_STABLE_TICKS'),
      tegemStreamFirstChunkTimeoutMs: readNumber(env, 25_000, 'STREAM_FIRST_CHUNK_TIMEOUT_MS', 'TEGEM_STREAM_FIRST_CHUNK_TIMEOUT_MS'),
      tegemStreamMaxDurationMs: readNumber(env, 90_000, 'STREAM_MAX_DURATION_MS', 'TEGEM_STREAM_MAX_DURATION_MS'),
      tegemLegacyProfileImportPath:
        pick(env, 'TEGEM_IMPORT_PROFILE_FROM') ?? path.resolve(rootDir, '..', 'TeGem', '.playwright', 'profiles'),
    },
  };
}

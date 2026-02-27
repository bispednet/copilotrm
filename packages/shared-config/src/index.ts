export interface AppConfig {
  apiPort: number;
  dbUrl: string;
  redisUrl: string;
  elizaSourcePath: string;
  elizaEnvFile: string;
  llmProvider: 'local' | 'api';
}

export function loadConfig(
  env: Record<string, string | undefined> = (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  )
): AppConfig {
  return {
    apiPort: Number(env.PORT_API_CORE ?? 4010),
    dbUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/copilotrm',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    elizaSourcePath: env.ELIZA_SOURCE_PATH ?? '/home/funboy/eliza',
    elizaEnvFile: env.ELIZA_ENV_FILE ?? '/home/funboy/eliza/.env',
    llmProvider: (env.LLM_PROVIDER as 'local' | 'api') ?? 'local',
  };
}

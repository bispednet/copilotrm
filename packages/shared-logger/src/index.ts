export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function log(level: LogLevel, message: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const suffix = meta === undefined ? '' : ` ${JSON.stringify(meta)}`;
  // eslint-disable-next-line no-console
  console.log(`[${ts}] [${level.toUpperCase()}] ${message}${suffix}`);
}

export const logger = {
  debug: (message: string, meta?: unknown) => log('debug', message, meta),
  info: (message: string, meta?: unknown) => log('info', message, meta),
  warn: (message: string, meta?: unknown) => log('warn', message, meta),
  error: (message: string, meta?: unknown) => log('error', message, meta),
};

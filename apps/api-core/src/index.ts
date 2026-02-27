import { loadConfig } from '@bisp/shared-config';
import { logger } from '@bisp/shared-logger';
import { buildServer } from './server';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildServer();
  try {
    await app.listen({ port: config.apiPort, host: '0.0.0.0' });
    logger.info('api-core listening', { port: config.apiPort });
  } catch (error) {
    logger.error('api-core failed to start', error);
    process.exit(1);
  }
}

void main();

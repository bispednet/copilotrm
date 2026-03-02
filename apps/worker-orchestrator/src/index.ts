import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { logger } from '@bisp/shared-logger';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueMode = /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline';
const apiCoreUrl = process.env.COPILOTRM_API_URL ?? process.env.API_CORE_URL ?? `http://localhost:${process.env.PORT_API_CORE ?? 4010}`;

async function preflightRedis(url: string): Promise<boolean> {
  const timeoutMs = Number(process.env.BISPCRM_REDIS_CONNECT_TIMEOUT_MS ?? 3000);
  const client = new IORedis(url, {
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
    connectTimeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000,
  });
  try {
    const pong = await client.ping();
    return pong === 'PONG';
  } catch (error) {
    logger.warn('worker-orchestrator redis preflight failed', { error: error instanceof Error ? error.message : String(error), redisUrl: url });
    return false;
  } finally {
    await client.quit().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  if (queueMode !== 'redis') {
    logger.info('worker-orchestrator idle (queue mode inline)', { queueMode });
    setInterval(() => undefined, 60 * 60 * 1000);
    return;
  }

  if (!(await preflightRedis(redisUrl))) {
    logger.warn('worker-orchestrator idle (redis unavailable)', { queueMode, redisUrl });
    setInterval(() => undefined, 60 * 60 * 1000);
    return;
  }

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
    connectTimeout: Number(process.env.BISPCRM_REDIS_CONNECT_TIMEOUT_MS ?? 3000),
  });
  connection.on('error', (err) => logger.error('worker-orchestrator redis error', { error: err.message, redisUrl }));

  const worker = new Worker(
    'orchestrator-events',
    async (job) => {
      logger.info('worker-orchestrator received job', { id: job.id, name: job.name });
      // job.data is the DomainEvent object (sent directly by queueGateway.enqueueOrchestrator)
      const event = job.data;
      try {
        const res = await fetch(`${apiCoreUrl}/api/orchestrate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-bisp-role': 'system' },
          body: JSON.stringify({ event }),
          signal: AbortSignal.timeout(Number(process.env.BISPCRM_ORCHESTRATOR_API_TIMEOUT_MS ?? 5000)),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`api-core responded ${res.status}: ${text}`);
        }
        const result = await res.json() as { swarmRunId?: string };
        logger.info('worker-orchestrator forwarded to api-core', { jobId: job.id, swarmRunId: result.swarmRunId ?? 'n/a' });
        return { ok: true, swarmRunId: result.swarmRunId, processedAt: new Date().toISOString() };
      } catch (err) {
        logger.error('worker-orchestrator forward failed', { jobId: job.id, error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    },
    { connection }
  );

  worker.on('completed', (job, result) => logger.info('worker-orchestrator completed', { id: job.id, swarmRunId: (result as { swarmRunId?: string })?.swarmRunId }));
  worker.on('failed', (job, err) => logger.error('worker-orchestrator failed', { id: job?.id, error: err.message }));
  worker.on('error', (err) => logger.error('worker-orchestrator worker error', { error: err.message }));

  logger.info('worker-orchestrator online', { queue: 'orchestrator-events', redisUrl, queueMode, apiCoreUrl });
}

void main().catch((error) => {
  logger.error('worker-orchestrator startup failed', { error: error instanceof Error ? error.message : String(error) });
});

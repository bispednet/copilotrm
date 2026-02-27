import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { logger } from '@bisp/shared-logger';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueMode = /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline';
const apiCoreUrl = `http://localhost:${process.env.PORT_API_CORE ?? 4010}`;

if (queueMode !== 'redis') {
  logger.info('worker-orchestrator idle (queue mode inline)', { queueMode });
  setInterval(() => undefined, 60 * 60 * 1000);
} else {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
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

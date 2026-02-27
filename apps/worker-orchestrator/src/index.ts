import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { logger } from '@bisp/shared-logger';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueMode = /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline';

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
      logger.info('worker-orchestrator received job', { id: job.id, name: job.name, data: job.data });
      return { ok: true, processedAt: new Date().toISOString() };
    },
    { connection }
  );

  worker.on('completed', (job) => logger.info('worker-orchestrator completed', { id: job.id }));
  worker.on('failed', (job, err) => logger.error('worker-orchestrator failed', { id: job?.id, error: err.message }));
  worker.on('error', (err) => logger.error('worker-orchestrator worker error', { error: err.message }));

  logger.info('worker-orchestrator online', { queue: 'orchestrator-events', redisUrl, queueMode });
}

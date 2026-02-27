import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { DaneaReadOnlyStub } from '@bisp/integrations-danea';
import { logger } from '@bisp/shared-logger';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueMode = /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline';
const danea = new DaneaReadOnlyStub();

async function main(): Promise<void> {
  if (queueMode !== 'redis') {
    logger.info('worker-ingest skipped (queue mode inline)', { queueMode });
    return;
  }
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
  });
  connection.on('error', (err) => logger.error('worker-ingest redis error', { error: err.message, redisUrl }));
  const orchestratorQueue = new Queue('orchestrator-events', { connection });
  const invoices = danea.listRecentInvoices();
  for (const invoice of invoices) {
    const event = danea.toDomainEvent(invoice);
    await orchestratorQueue.add('danea.invoice.ingested', event, { removeOnComplete: 1000, removeOnFail: 1000 });
  }
  logger.info('worker-ingest enqueued events', { count: invoices.length, queue: 'orchestrator-events' });
  await orchestratorQueue.close();
  await connection.quit();
}

void main().catch((error) => {
  logger.error('worker-ingest failed', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});

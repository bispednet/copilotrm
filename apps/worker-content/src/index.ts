import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { InMemoryRAGStore } from '@bisp/integrations-eliza';
import { MediaGenerationServiceStub } from '@bisp/integrations-media';
import { PgRuntime } from '@bisp/shared-db';
import { logger } from '@bisp/shared-logger';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueMode = /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline';
const rag = new InMemoryRAGStore();
const media = new MediaGenerationServiceStub();
const pg =
  /^(postgres|hybrid)$/i.test(process.env.BISPCRM_PERSISTENCE_MODE ?? 'memory')
    ? new PgRuntime({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/copilotrm' })
    : undefined;

rag.add({ id: 'seed:content', text: 'Template content factory per promo hardware, smartphone, fibra, energia.' });

if (queueMode !== 'redis') {
  logger.info('worker-content idle (queue mode inline)', { queueMode });
  setInterval(() => undefined, 60 * 60 * 1000);
} else {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
  });
  connection.on('error', (err) => logger.error('worker-content redis error', { error: err.message, redisUrl }));

  const worker = new Worker(
    'content-jobs',
    async (job) => {
      logger.info('worker-content job', { id: job.id, name: job.name });
      const hints = rag.search(String(job.data?.prompt ?? ''), 3);
      return { ok: true, hints };
    },
    { connection }
  );

  worker.on('completed', (job) => logger.info('worker-content completed', { id: job.id }));
  worker.on('failed', (job, err) => logger.error('worker-content failed', { id: job?.id, error: err.message }));
  worker.on('error', (err) => logger.error('worker-content worker error', { error: err.message }));

  const mediaWorker = new Worker(
    'media-jobs',
    async (job) => {
      logger.info('worker-content media job', { id: job.id, name: job.name });
      const payload = job.data as {
        id: string;
        kind: 'text' | 'voice-script' | 'avatar-video' | 'podcast';
        title: string;
        brief: string;
        channel?: 'blog' | 'facebook' | 'instagram' | 'x' | 'telegram' | 'whatsapp';
      };
      if (!payload?.id || !payload?.kind || !payload?.title || !payload?.brief) {
        throw new Error('invalid media job payload');
      }
      const result = await media.generate({
        kind: payload.kind,
        title: payload.title,
        brief: payload.brief,
        channel: payload.channel,
      });
      if (pg) {
        await pg.runMigrations();
        await pg.pool.query(
          `update media_jobs
           set status='completed', result_payload=$2::jsonb, processed_at=now(), updated_at=now()
           where id=$1`,
          [payload.id, JSON.stringify(result)]
        );
      }
      return { ok: true };
    },
    { connection }
  );

  mediaWorker.on('failed', async (job, err) => {
    logger.error('worker-content media failed', { id: job?.id, error: err.message });
    const payload = job?.data as { id?: string } | undefined;
    if (pg && payload?.id) {
      await pg.runMigrations().catch(() => undefined);
      await pg.pool
        .query(
          `update media_jobs
           set status='failed', error=$2, processed_at=now(), updated_at=now()
           where id=$1`,
          [payload.id, err.message]
        )
        .catch(() => undefined);
    }
  });
  mediaWorker.on('error', (err) => logger.error('worker-content media worker error', { error: err.message }));
  logger.info('worker-content online', { queue: 'content-jobs', redisUrl, queueMode });
}

import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { SocialChannelAdapter } from '@bisp/integrations-social';
import { TelegramChannelAdapter } from '@bisp/integrations-telegram';
import { logger } from '@bisp/shared-logger';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueMode = /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline';
const social = new SocialChannelAdapter();
const telegram = new TelegramChannelAdapter();

if (queueMode !== 'redis') {
  logger.info('worker-social idle (queue mode inline)', { queueMode });
  setInterval(() => undefined, 60 * 60 * 1000);
} else {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
  });
  connection.on('error', (err) => logger.error('worker-social redis error', { error: err.message, redisUrl }));

  const worker = new Worker(
    'social-publish',
    async (job) => {
      logger.info('worker-social job', { id: job.id, name: job.name, channel: job.data?.channel });
      if (job.data?.channel === 'telegram') return telegram.queueOfferMessage(job.data);
      return social.publish(job.data);
    },
    { connection }
  );

  worker.on('completed', (job) => logger.info('worker-social completed', { id: job.id }));
  worker.on('failed', (job, err) => logger.error('worker-social failed', { id: job?.id, error: err.message }));
  worker.on('error', (err) => logger.error('worker-social worker error', { error: err.message }));
  logger.info('worker-social online', { queue: 'social-publish', redisUrl, queueMode });
}

import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { SocialChannelAdapter } from '@bisp/integrations-social';
import { TelegramChannelAdapter } from '@bisp/integrations-telegram';
import { EmailChannelAdapter } from '@bisp/integrations-email';
import { WhatsAppChannelAdapter } from '@bisp/integrations-whatsapp';
import { logger } from '@bisp/shared-logger';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueMode = /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline';
const social = new SocialChannelAdapter();
const telegram = new TelegramChannelAdapter();
const email = new EmailChannelAdapter();
const whatsapp = new WhatsAppChannelAdapter();

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
    logger.warn('worker-social redis preflight failed', { error: error instanceof Error ? error.message : String(error), redisUrl: url });
    return false;
  } finally {
    await client.quit().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  if (queueMode !== 'redis') {
    logger.info('worker-social idle (queue mode inline)', { queueMode });
    setInterval(() => undefined, 60 * 60 * 1000);
    return;
  }

  if (!(await preflightRedis(redisUrl))) {
    logger.warn('worker-social idle (redis unavailable)', { queueMode, redisUrl });
    setInterval(() => undefined, 60 * 60 * 1000);
    return;
  }

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
    connectTimeout: Number(process.env.BISPCRM_REDIS_CONNECT_TIMEOUT_MS ?? 3000),
  });
  connection.on('error', (err) => logger.error('worker-social redis error', { error: err.message, redisUrl }));

  const worker = new Worker(
    'social-publish',
    async (job) => {
      const channel = job.data?.channel as string | undefined;
      logger.info('worker-social job', { id: job.id, name: job.name, channel });
      if (channel === 'telegram') return telegram.queueOfferMessage(job.data);
      if (channel === 'email') return email.sendOrQueue(job.data);
      if (channel === 'whatsapp') return whatsapp.sendOrQueue(job.data);
      return social.publish(job.data);
    },
    { connection }
  );

  worker.on('completed', (job) => logger.info('worker-social completed', { id: job.id }));
  worker.on('failed', (job, err) => logger.error('worker-social failed', { id: job?.id, error: err.message }));
  worker.on('error', (err) => logger.error('worker-social worker error', { error: err.message }));
  logger.info('worker-social online', { queue: 'social-publish', redisUrl, queueMode });
}

void main().catch((error) => {
  logger.error('worker-social startup failed', { error: error instanceof Error ? error.message : String(error) });
});

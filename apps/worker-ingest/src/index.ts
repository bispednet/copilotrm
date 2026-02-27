import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { DaneaReadOnlyStub } from '@bisp/integrations-danea';
import { fetchAllRssFeeds, RssStateTracker, rssItemToEvent, type RssSource } from '@bisp/integrations-rss';
import { logger } from '@bisp/shared-logger';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueMode = /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline';
const danea = new DaneaReadOnlyStub();

/** Feed RSS da env var RSS_FEEDS (JSON array) o defaults tech/telecom italiani */
function getRssSources(): RssSource[] {
  const raw = process.env.RSS_FEEDS;
  if (raw) {
    try {
      return JSON.parse(raw) as RssSource[];
    } catch {
      logger.warn('worker-ingest: RSS_FEEDS env non è JSON valido, uso defaults');
    }
  }
  return [
    { url: 'https://www.hwupgrade.it/rss/news.xml', name: 'HWUpgrade', category: 'tech' },
    { url: 'https://www.tomshw.it/feed', name: 'TomsHW', category: 'tech' },
    { url: 'https://www.mondomobileweb.it/feed/', name: 'MondoMobileWeb', category: 'mobile' },
  ];
}

const rssTracker = new RssStateTracker();

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
  const contentQueue = new Queue('content-jobs', { connection });

  // ── Danea (fonte primaria: clienti, fatture, offerte) ─────────────────────
  const invoices = danea.listRecentInvoices();
  for (const invoice of invoices) {
    const event = danea.toDomainEvent(invoice);
    await orchestratorQueue.add('danea.invoice.ingested', event, { removeOnComplete: 1000, removeOnFail: 1000 });
  }
  logger.info('worker-ingest danea: enqueued events', { count: invoices.length });

  // ── RSS (fonte addizionale: notizie tech per content pipeline) ────────────
  const sources = getRssSources();
  const allItems = await fetchAllRssFeeds(sources);
  const newItems = rssTracker.filterNew(allItems);
  rssTracker.markSeen(newItems);

  for (const item of newItems) {
    const event = rssItemToEvent(item);
    await contentQueue.add('rss.item.ingested', event, { removeOnComplete: 500, removeOnFail: 500 });
  }
  logger.info('worker-ingest rss: enqueued new items', {
    total: allItems.length,
    new: newItems.length,
    sources: sources.map((s) => s.name),
  });

  await orchestratorQueue.close();
  await contentQueue.close();
  await connection.quit();
}

void main().catch((error) => {
  logger.error('worker-ingest failed', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});

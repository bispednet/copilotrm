import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { DaneaReadOnlyStub } from '@bisp/integrations-danea';
import { fetchAllRssFeeds, RssStateTracker, rssItemToEvent, type RssSource } from '@bisp/integrations-rss';
import { logger } from '@bisp/shared-logger';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueMode = /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline';
const danea = new DaneaReadOnlyStub();

/**
 * Feed RSS da env var RSS_FEEDS (JSON array di RssSource) o defaults curati.
 * Formato env: RSS_FEEDS='[{"url":"...","name":"...","category":"..."}]'
 */
function getRssSources(): RssSource[] {
  const raw = process.env.RSS_FEEDS;
  if (raw) {
    try {
      return JSON.parse(raw) as RssSource[];
    } catch {
      logger.warn('worker-ingest: RSS_FEEDS env non è JSON valido, uso defaults');
    }
  }
  // Defaults curati: hardware, smartphone, TLC, energia, tech — IT + internazionali
  return [
    // ── IT hardware & tech ──────────────────────────────────────────────────
    { url: 'https://www.hwupgrade.it/rss/news.xml',              name: 'HWUpgrade',        category: 'hardware'   },
    { url: 'https://www.tomshw.it/feed',                          name: 'TomsHW_IT',        category: 'hardware'   },
    { url: 'https://www.punto-informatico.it/feed/',              name: 'PuntoInformatico', category: 'tech'       },
    { url: 'https://www.wired.it/feed/rss',                       name: 'WiredIT',          category: 'tech'       },
    { url: 'https://www.ilsoftware.it/feed',                      name: 'IlSoftware',       category: 'software'   },
    { url: 'https://www.bitmat.it/feed/',                         name: 'BitMat',           category: 'enterprise' },
    // ── IT smartphone & mobile ──────────────────────────────────────────────
    { url: 'https://www.hdblog.it/feed/',                         name: 'HDBlog',           category: 'smartphone' },
    { url: 'https://www.smartworld.it/feed',                      name: 'SmartWorld',       category: 'smartphone' },
    { url: 'https://www.mondomobileweb.it/feed/',                 name: 'MondoMobileWeb',   category: 'mobile'     },
    // ── IT TLC & connectivity ───────────────────────────────────────────────
    { url: 'https://www.key4biz.it/feed/',                        name: 'Key4Biz',          category: 'tlc'        },
    { url: 'https://corrierecomunicazioni.it/feed/',              name: 'CorriereComu',     category: 'tlc'        },
    // ── IT energia ──────────────────────────────────────────────────────────
    { url: 'https://www.rinnovabili.it/feed/',                    name: 'Rinnovabili',      category: 'energy'     },
    { url: 'https://www.canaleenergia.com/feed/',                 name: 'CanaleEnergia',    category: 'energy'     },
    // ── Internazionale hardware ──────────────────────────────────────────────
    { url: 'https://arstechnica.com/feed/',                       name: 'ArsTechnica',      category: 'tech'       },
    { url: 'https://www.theverge.com/rss/index.xml',              name: 'TheVerge',         category: 'tech'       },
    { url: 'https://www.techradar.com/rss',                       name: 'TechRadar',        category: 'tech'       },
    { url: 'https://www.zdnet.com/news/rss.xml',                  name: 'ZDNet',            category: 'enterprise' },
    { url: 'https://www.ilsole24ore.com/rss/tecnologia.xml',      name: 'Sole24Tech',       category: 'tech'       },
    // ── Internazionale smartphone ────────────────────────────────────────────
    { url: 'https://www.gsmarena.com/rss-news-reviews.php3',      name: 'GSMArena',         category: 'smartphone' },
    { url: 'https://9to5google.com/feed/',                         name: '9to5Google',       category: 'android'    },
    { url: 'https://9to5mac.com/feed/',                            name: '9to5Mac',          category: 'apple'      },
  ];
}

const rssTracker = new RssStateTracker();

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
    logger.warn('worker-ingest redis preflight failed', { error: error instanceof Error ? error.message : String(error), redisUrl: url });
    return false;
  } finally {
    await client.quit().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  if (queueMode !== 'redis') {
    logger.info('worker-ingest skipped (queue mode inline)', { queueMode });
    return;
  }

  if (!(await preflightRedis(redisUrl))) {
    logger.warn('worker-ingest skipped (redis unavailable)', { redisUrl, queueMode });
    return;
  }

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
    connectTimeout: Number(process.env.BISPCRM_REDIS_CONNECT_TIMEOUT_MS ?? 3000),
  });
  connection.on('error', (err) => logger.error('worker-ingest redis error', { error: err.message, redisUrl }));

  const orchestratorQueue = new Queue('orchestrator-events', {
    connection,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 1500 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });
  const contentQueue = new Queue('content-jobs', {
    connection,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 1500 },
      removeOnComplete: 500,
      removeOnFail: 500,
    },
  });

  // ── Danea (fonte primaria: clienti, fatture, offerte) ─────────────────────
  const invoices = danea.listRecentInvoices();
  for (const invoice of invoices) {
    const event = danea.toDomainEvent(invoice);
    // Dual-queue: orchestrator per regole CRM + content per content factory
    await orchestratorQueue.add('danea.invoice.ingested', event, { jobId: `danea:${event.id}` });
    await contentQueue.add('danea.invoice.ingested', event, { jobId: `content:danea:${event.id}` });
  }
  logger.info('worker-ingest danea: enqueued events', { count: invoices.length });

  // ── RSS (fonte addizionale: notizie tech per content pipeline) ────────────
  const sources = getRssSources();
  const allItems = await fetchAllRssFeeds(sources);
  const newItems = rssTracker.filterNew(allItems);
  rssTracker.markSeen(newItems);

  for (const item of newItems) {
    const event = rssItemToEvent(item);
    await contentQueue.add('rss.item.ingested', event, { jobId: `content:rss:${event.payload.id}` });
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

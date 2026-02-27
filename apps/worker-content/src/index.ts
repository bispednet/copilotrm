import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { InMemoryRAGStore } from '@bisp/integrations-eliza';
import { MediaGenerationServiceStub } from '@bisp/integrations-media';
import { AgentDiscussion, type DiscussionAgent } from '@bisp/agent-bus';
import { createWordPressClientFromEnv } from '@bisp/integrations-wordpress';
import { createLLMClient } from '@bisp/integrations-llm';
import { loadConfig } from '@bisp/shared-config';
import { PgRuntime } from '@bisp/shared-db';
import { logger } from '@bisp/shared-logger';
import type { RssIngestedEvent } from '@bisp/integrations-rss';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queueMode = /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline';
const rag = new InMemoryRAGStore();
const media = new MediaGenerationServiceStub();
const pg =
  /^(postgres|hybrid)$/i.test(process.env.BISPCRM_PERSISTENCE_MODE ?? 'memory')
    ? new PgRuntime({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/copilotrm' })
    : undefined;

rag.add({ id: 'seed:content', text: 'Template content factory per promo hardware, smartphone, fibra, energia.' });

// ── LLM + discussione ─────────────────────────────────────────────────────────
let discussion: AgentDiscussion | null = null;
try {
  const cfg = loadConfig();
  const llm = createLLMClient(cfg.llm);
  discussion = new AgentDiscussion(llm);
} catch {
  logger.warn('worker-content: LLM non configurato, content pipeline usa stub');
}

const wp = createWordPressClientFromEnv();
if (!wp) logger.info('worker-content: WordPress non configurato, publish disabilitato');

/** Agenti del roundtable per la content pipeline */
const CONTENT_AGENTS: DiscussionAgent[] = [
  { name: 'ContentStrategist', role: 'esperto di content marketing e SEO', persona: 'Identifica angle editoriali e keyword rilevanti.' },
  { name: 'TechEditor', role: 'editor tecnico specializzato in tech/telecom', persona: 'Verifica accuratezza tecnica e chiarezza del contenuto.' },
  { name: 'CopyWriter', role: 'copywriter commerciale', persona: 'Ottimizza il tono per conversione e engagement.' },
];

/**
 * Genera un articolo blog a partire da un item RSS tramite:
 * 1. AgentDiscussion roundtable — analizza angle, keyword, struttura
 * 2. LLM — scrive il post completo basandosi sulla sintesi della discussione
 * 3. WordPress — pubblica come draft
 */
async function runContentPipeline(item: RssIngestedEvent['payload']): Promise<{ ok: boolean; postId?: number; link?: string }> {
  const topic = `Articolo blog su: "${item.title}"`;
  const context = [item.description, item.category ? `Categoria: ${item.category}` : ''].filter(Boolean).join(' | ');

  let synthesis = `Crea un articolo informativo e coinvolgente su: ${item.title}. ${context}`;

  // ── 1. Roundtable discussione (se LLM disponibile) ────────────────────────
  if (discussion) {
    try {
      const result = await discussion.discuss({ topic, context, agents: CONTENT_AGENTS, rounds: 1 });
      if (result.synthesis) {
        synthesis = result.synthesis;
        logger.info('worker-content: discussione completata', {
          topic,
          agents: CONTENT_AGENTS.map((a) => a.name),
          synthesisLength: synthesis.length,
        });
      }
    } catch (err) {
      logger.warn('worker-content: discussione fallita, continuo con prompt diretto', { error: String(err) });
    }
  }

  // ── 2. Genera post completo con LLM ───────────────────────────────────────
  let postContent = `<h2>${item.title}</h2>\n<p>${item.description}</p>\n<p>Fonte: <a href="${item.link}">${item.sourceName ?? item.link}</a></p>`;
  let postExcerpt = item.description.slice(0, 160);

  if (discussion) {
    try {
      const llmCfg = loadConfig();
      const llm = createLLMClient(llmCfg.llm);
      const resp = await llm.chat(
        [
          {
            role: 'system',
            content:
              'Sei un content writer specializzato in tech e telecomunicazioni. Scrivi articoli informativi in italiano per un blog aziendale.',
          },
          {
            role: 'user',
            content: [
              `Scrivi un articolo blog completo in italiano basato su questa notizia.`,
              ``,
              `Titolo notizia: ${item.title}`,
              `Descrizione: ${item.description}`,
              context,
              ``,
              `Indicazioni dalla redazione: ${synthesis}`,
              ``,
              `Formato richiesto:`,
              `- Titolo SEO accattivante (max 70 caratteri)`,
              `- Introduzione (2-3 frasi)`,
              `- 2-3 sezioni con sottotitoli H2`,
              `- Conclusione con CTA`,
              `- Max 400 parole totali`,
              ``,
              `Restituisci SOLO l'HTML dell'articolo (h1, h2, p tags), senza spiegazioni.`,
            ].join('\n'),
          },
        ],
        { tier: 'medium', maxTokens: 800 }
      );
      postContent = resp.content;
      // Extract excerpt from first paragraph
      const firstParagraph = postContent.match(/<p[^>]*>(.*?)<\/p>/s);
      if (firstParagraph) postExcerpt = firstParagraph[1].replace(/<[^>]+>/g, '').slice(0, 160);
    } catch (err) {
      logger.warn('worker-content: generazione articolo LLM fallita, uso stub', { error: String(err) });
    }
  }

  // ── 3. Pubblica su WordPress ──────────────────────────────────────────────
  if (!wp) {
    logger.info('worker-content: WordPress non configurato, skip publish', { title: item.title });
    return { ok: true };
  }

  try {
    // Extract h1 title from generated content if available
    const titleMatch = postContent.match(/<h1[^>]*>(.*?)<\/h1>/s);
    const postTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '') : item.title;

    const result = await wp.createPost({
      title: postTitle,
      content: postContent,
      excerpt: postExcerpt,
      status: 'draft',
      slug: item.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60),
    });
    logger.info('worker-content: post WordPress creato', { postId: result.id, link: result.link, title: result.title });
    return { ok: true, postId: result.id, link: result.link };
  } catch (err) {
    logger.error('worker-content: WordPress publish fallito', { error: String(err), title: item.title });
    return { ok: false };
  }
}

if (queueMode !== 'redis') {
  logger.info('worker-content idle (queue mode inline)', { queueMode });
  setInterval(() => undefined, 60 * 60 * 1000);
} else {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
  });
  connection.on('error', (err) => logger.error('worker-content redis error', { error: err.message, redisUrl }));

  // ── Worker: content-jobs generico ────────────────────────────────────────
  const worker = new Worker(
    'content-jobs',
    async (job) => {
      logger.info('worker-content job', { id: job.id, name: job.name });

      // Pipeline RSS → discuss → blogpost → WordPress
      if (job.name === 'rss.item.ingested') {
        const event = job.data as RssIngestedEvent;
        const result = await runContentPipeline(event.payload);
        return result;
      }

      // Jobs generici: RAG search hints
      const hints = rag.search(String(job.data?.prompt ?? ''), 3);
      return { ok: true, hints };
    },
    { connection }
  );

  worker.on('completed', (job) => logger.info('worker-content completed', { id: job.id, name: job.name }));
  worker.on('failed', (job, err) => logger.error('worker-content failed', { id: job?.id, error: err.message }));
  worker.on('error', (err) => logger.error('worker-content worker error', { error: err.message }));

  // ── Worker: media-jobs ────────────────────────────────────────────────────
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
  logger.info('worker-content online', { queues: ['content-jobs', 'media-jobs'], redisUrl, wpEnabled: !!wp });
}

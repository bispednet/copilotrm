import Fastify from 'fastify';
import type { CommunicationDraft } from '@bisp/shared-types';
import { TelegramChannelAdapter } from '@bisp/integrations-telegram';
import { EmailChannelAdapter } from '@bisp/integrations-email';
import { SocialChannelAdapter } from '@bisp/integrations-social';
import { WhatsAppChannelAdapter } from '@bisp/integrations-whatsapp';
import { PgRuntime } from '@bisp/shared-db';
import { isAllowed, resolveAuth } from '@bisp/shared-auth';
import { loadConfig } from '@bisp/shared-config';

const app = Fastify({ logger: false });

const telegram = new TelegramChannelAdapter();
const email = new EmailChannelAdapter();
const social = new SocialChannelAdapter();
const whatsapp = new WhatsAppChannelAdapter();
const cfg = loadConfig();
const apiCoreUrl =
  process.env.COPILOTRM_API_URL ??
  process.env.API_CORE_URL ??
  `http://localhost:${process.env.PORT_API_CORE ?? 4010}`;
const persistenceEnabled = /^(postgres|hybrid)$/i.test(process.env.BISPCRM_PERSISTENCE_MODE ?? 'memory');
const authMode = (process.env.BISPCRM_AUTH_MODE ?? 'header') as 'none' | 'header';
const pg = persistenceEnabled
  ? new PgRuntime({ connectionString: cfg.dbUrl, migrationsDir: cfg.migrationsDir })
  : undefined;

let migrationsReady = false;
async function ensureMigrations(): Promise<boolean> {
  if (!pg) return false;
  if (migrationsReady) return true;
  await pg.runMigrations();
  migrationsReady = true;
  return true;
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

async function postInboundToApiCore(event: Record<string, unknown>): Promise<void> {
  const timeoutMs = Number(process.env.BISPCRM_GATEWAY_INBOUND_TIMEOUT_MS ?? 3000);
  await fetch(`${apiCoreUrl}/api/orchestrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bisp-role': 'system' },
    body: JSON.stringify({ event }),
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000),
  });
}

async function persistDispatch(record: {
  id: string;
  draftId?: string;
  channel: string;
  status: 'queued' | 'sent' | 'failed';
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  error?: string;
}): Promise<void> {
  if (!(await ensureMigrations()) || !pg) return;
  const now = new Date().toISOString();
  await pg.pool.query(
    `insert into channel_dispatches (id, source, draft_id, channel, status, request_payload, response_payload, error, created_at, sent_at, updated_at)
     values ($1,'gateway-channels',$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::timestamptz,$9::timestamptz, now())
     on conflict (id) do update set status=excluded.status, response_payload=excluded.response_payload, error=excluded.error, sent_at=excluded.sent_at, updated_at=now()`,
    [
      record.id,
      record.draftId ?? null,
      record.channel,
      record.status,
      JSON.stringify(record.requestPayload),
      JSON.stringify(record.responsePayload),
      record.error ?? null,
      now,
      record.status === 'failed' ? null : now,
    ]
  );
}

app.get('/health', async () => ({ ok: true, service: 'gateway-channels', ts: new Date().toISOString() }));
app.get('/api/channels/dispatches', async (req, reply) => {
  if (authMode === 'header' && !req.headers['x-bisp-role']) return reply.code(401).send({ error: 'Missing x-bisp-role header', authMode });
  if (!isAllowed(req.headers as Record<string, unknown>, authMode, 'outbox:read')) {
    const auth = resolveAuth(req.headers as Record<string, unknown>, authMode);
    return reply.code(403).send({ error: 'Forbidden', role: auth.role, permission: 'outbox:read', authMode });
  }
  if (!(await ensureMigrations()) || !pg) return [];
  const res = await pg.pool.query<{ id: string; source: string; draft_id: string | null; channel: string; status: string; request_payload: unknown; response_payload: unknown; error: string | null; created_at: string; sent_at: string | null }>(
    `select id, source, draft_id, channel, status, request_payload, response_payload, error, created_at::text, sent_at::text
     from channel_dispatches
     where source = 'gateway-channels'
     order by created_at desc
     limit 200`
  );
  return res.rows;
});

app.post<{ Body: { draft: CommunicationDraft; recipientRef?: string } }>('/api/channels/send', async (req, reply) => {
  if (authMode === 'header' && !req.headers['x-bisp-role']) return reply.code(401).send({ error: 'Missing x-bisp-role header', authMode });
  if (!isAllowed(req.headers as Record<string, unknown>, authMode, 'outbox:approve')) {
    const auth = resolveAuth(req.headers as Record<string, unknown>, authMode);
    return reply.code(403).send({ error: 'Forbidden', role: auth.role, permission: 'outbox:approve', authMode });
  }
  const { draft, recipientRef } = req.body;
  if (!draft?.channel || !draft?.body) return reply.code(400).send({ error: 'draft.channel and draft.body are required' });
  // recipientRef da body ha priorità su draft.recipientRef
  const resolvedDraft: CommunicationDraft = recipientRef ? { ...draft, recipientRef } : draft;
  const dispatchId = makeId('dispatch');
  const draftId = draft.id;

  try {
    if (resolvedDraft.channel === 'telegram') {
      const res = await telegram.queueOfferMessage(resolvedDraft);
      await persistDispatch({
        id: dispatchId,
        draftId,
        channel: resolvedDraft.channel,
        status: res.sent ? 'sent' : 'queued',
        requestPayload: { draft: resolvedDraft },
        responsePayload: { queued: res.queued, sent: res.sent, messageId: res.messageId },
        error: res.error,
      });
      return { mode: 'telegram', dispatchId, result: res };
    }

    if (resolvedDraft.channel === 'email') {
      const res = await email.sendOrQueue(resolvedDraft);
      await persistDispatch({
        id: dispatchId,
        draftId,
        channel: resolvedDraft.channel,
        status: res.status === 'sent' ? 'sent' : res.status === 'failed' ? 'failed' : 'queued',
        requestPayload: { draft: resolvedDraft },
        responsePayload: { status: res.status, messageId: res.messageId },
        error: res.error,
      });
      return { mode: 'email', dispatchId, result: res };
    }

    if (resolvedDraft.channel === 'whatsapp') {
      const res = await whatsapp.sendOrQueue(resolvedDraft);
      await persistDispatch({
        id: dispatchId,
        draftId,
        channel: resolvedDraft.channel,
        status: res.status === 'sent' ? 'sent' : res.status === 'failed' ? 'failed' : 'queued',
        requestPayload: { draft: resolvedDraft },
        responsePayload: { ok: res.ok, status: res.status, messageId: res.messageId },
        error: res.error,
      });
      return { mode: 'whatsapp', dispatchId, result: res };
    }

    if (['facebook', 'instagram', 'x'].includes(resolvedDraft.channel)) {
      const res = await social.publish(resolvedDraft);
      await persistDispatch({
        id: dispatchId,
        draftId,
        channel: resolvedDraft.channel,
        status: res.queued ? 'queued' : 'failed',
        requestPayload: { draft: resolvedDraft },
        responsePayload: { queued: res.queued, platform: res.platform },
      });
      return { mode: 'social', dispatchId, result: res };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistDispatch({
      id: dispatchId,
      draftId,
      channel: resolvedDraft.channel,
      status: 'failed',
      requestPayload: { draft: resolvedDraft },
      responsePayload: {},
      error: message,
    });
    return reply.code(502).send({ error: 'Channel send failed', detail: message, dispatchId });
  }

  return reply.code(400).send({ error: `Unsupported channel ${resolvedDraft.channel}` });
});

// ── Inbound webhook: Telegram ─────────────────────────────────────────────
app.post<{ Body: Record<string, unknown> }>('/api/inbound/telegram', async (req, reply) => {
  const update = req.body;
  const message = (update.message ?? update.edited_message) as Record<string, unknown> | undefined;
  if (!message) return reply.code(200).send({ ok: true, skipped: true });
  const from = message.from as Record<string, unknown> | undefined;
  const chat = message.chat as Record<string, unknown> | undefined;
  const text = String(message.text ?? '').trim();
  if (!text) return reply.code(200).send({ ok: true, skipped: true });

  const event = {
    id: `tg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'inbound.whatsapp.received',
    occurredAt: new Date().toISOString(),
    payload: {
      channel: 'telegram',
      from: String(from?.username ?? from?.id ?? 'unknown'),
      chatId: String(chat?.id ?? ''),
      body: text,
      subject: '',
    },
  };
  try {
    await postInboundToApiCore(event as unknown as Record<string, unknown>);
  } catch { /* best-effort, Telegram expects 200 */ }
  return reply.code(200).send({ ok: true });
});

// ── Inbound webhook: WhatsApp (Meta Cloud API) ────────────────────────────
app.get<{ Querystring: Record<string, string> }>('/api/inbound/whatsapp', async (req, reply) => {
  const q = req.query;
  if (q['hub.verify_token'] === (process.env.WHATSAPP_VERIFY_TOKEN ?? '') && q['hub.challenge']) {
    return reply.code(200).send(q['hub.challenge']);
  }
  return reply.code(403).send({ error: 'invalid verify token' });
});

app.post<{ Body: Record<string, unknown> }>('/api/inbound/whatsapp', async (req, reply) => {
  try {
    const entries = (req.body.entry as unknown[]) ?? [];
    for (const rawEntry of entries) {
      const entry = rawEntry as Record<string, unknown>;
      const changes = (entry.changes as unknown[]) ?? [];
      for (const rawChange of changes) {
        const change = rawChange as Record<string, unknown>;
        const value = change.value as Record<string, unknown> | undefined;
        const messages = (value?.messages as Array<Record<string, unknown>>) ?? [];
        for (const msg of messages) {
          const from = String(msg.from ?? '');
          const body = String((msg.text as Record<string, unknown> | undefined)?.body ?? '').trim();
          if (!body) continue;
          const event = {
            id: `wa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            type: 'inbound.whatsapp.received',
            occurredAt: new Date().toISOString(),
            payload: { channel: 'whatsapp', from, body, subject: '' },
          };
          await postInboundToApiCore(event as unknown as Record<string, unknown>);
        }
      }
    }
  } catch { /* must respond 200 to Meta */ }
  return reply.code(200).send({ ok: true });
});

app.addHook('onClose', async () => {
  await pg?.close().catch(() => undefined);
});

const port = Number(process.env.PORT ?? 4020);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  // eslint-disable-next-line no-console
  console.log(`[gateway-channels] listening on :${port}`);
});

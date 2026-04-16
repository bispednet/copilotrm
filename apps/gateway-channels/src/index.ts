import Fastify from 'fastify';
import type { CommunicationDraft } from '@bisp/shared-types';
import type { ChannelButton, ChannelControlResponse } from '@bisp/channel-control';
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

async function postChannelControlToApiCore(payload: Record<string, unknown>): Promise<ChannelControlResponse> {
  const timeoutMs = Number(process.env.BISPCRM_GATEWAY_CONTROL_TIMEOUT_MS ?? process.env.BISPCRM_GATEWAY_INBOUND_TIMEOUT_MS ?? 12000);
  const res = await fetch(`${apiCoreUrl}/api/channels/control/handle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bisp-role': 'admin' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000),
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`channel control failed (${res.status}) ${errorBody}`.trim());
  }
  return res.json() as Promise<ChannelControlResponse>;
}

function toTelegramKeyboard(buttons?: ChannelButton[][]): Array<Array<{ text: string; callback_data?: string; url?: string }>> | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  return buttons.map((row) =>
    row.map((button) => ({
      text: button.label,
      callback_data: button.url ? undefined : String(button.id),
      url: button.url,
    }))
  );
}

async function sendTelegramControlResponse(chatId: string, messageId: number | undefined, response: ChannelControlResponse): Promise<void> {
  for (const instruction of response.instructions) {
    const keyboard = toTelegramKeyboard(instruction.buttons);
    if (instruction.mode === 'update-message' && messageId != null) {
      const edited = await telegram.editMessage(chatId, messageId, instruction.text, { parseMode: 'HTML', inlineKeyboard: keyboard });
      if (edited.ok) continue;
    }
    await telegram.sendMessage(chatId, instruction.text, { parseMode: 'HTML', inlineKeyboard: keyboard });
  }
}

async function sendWhatsAppControlResponse(peerId: string, response: ChannelControlResponse, peerType: 'private' | 'group' = 'private'): Promise<void> {
  for (const instruction of response.instructions) {
    const flatButtons = instruction.buttons?.flat() ?? [];
    if (flatButtons.length > 0 && flatButtons.length <= 3) {
      await whatsapp.sendInteractiveButtons(
        peerId,
        instruction.text,
        flatButtons.map((button) => ({ id: String(button.id), title: button.label })),
        'CopilotRM',
        peerType === 'group' ? 'group' : 'individual'
      );
      continue;
    }
    if (flatButtons.length > 3) {
      await whatsapp.sendInteractiveList(
        peerId,
        instruction.text,
        'Open actions',
        [{
          title: 'CopilotRM actions',
          rows: flatButtons.slice(0, 10).map((button) => ({
            id: String(button.id),
            title: button.label,
          })),
        }],
        'CopilotRM',
        peerType === 'group' ? 'group' : 'individual'
      );
      continue;
    }
    await whatsapp.sendText(peerId, instruction.text, false, peerType === 'group' ? 'group' : 'individual');
  }
}

function parseCsvSet(raw: string | undefined): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function extractWhatsAppPeer(msg: Record<string, unknown>, profileName: string): {
  peerId: string;
  messageText: string;
  actionId?: string;
  profile: {
    displayName?: string;
    peerType?: 'private' | 'group';
    groupName?: string;
    participantId?: string;
    participantName?: string;
  };
} | null {
  const interactive = asRecord(msg.interactive);
  const buttonReply = asRecord(interactive?.button_reply);
  const listReply = asRecord(interactive?.list_reply);
  const textBody = String(asRecord(msg.text)?.body ?? '').trim();
  const actionId = String(buttonReply?.id ?? listReply?.id ?? '').trim() || undefined;
  const messageText = textBody || String(buttonReply?.title ?? listReply?.title ?? '').trim();

  const context = asRecord(msg.context);
  const group = asRecord(msg.group) ?? asRecord(context?.group);
  const conversation = asRecord(msg.conversation) ?? asRecord(context?.conversation);
  const metadata = asRecord(msg.metadata);
  const groupId = firstString(
    msg.group_id,
    group?.id,
    conversation?.id,
    context?.group_id,
    msg.chat_id,
    msg.chatId
  );
  const groupName = firstString(group?.subject, group?.name, conversation?.name, context?.group_subject, context?.group_name);
  const peerType = groupId || String(msg.recipient_type ?? '').toLowerCase() === 'group' ? 'group' : 'private';
  const peerId = groupId ?? String(msg.from ?? '');
  if (!peerId || (!messageText && !actionId)) return null;
  const participantId = firstString(msg.from, context?.from, msg.author);
  return {
    peerId,
    messageText,
    actionId,
    profile: {
      displayName: profileName || firstString(asRecord(msg.profile)?.name, metadata?.display_phone_number),
      peerType,
      groupName,
      participantId,
      participantName: profileName || undefined,
    },
  };
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
  try {
    const callback = update.callback_query as Record<string, unknown> | undefined;
    if (callback) {
      const callbackMessage = callback.message as Record<string, unknown> | undefined;
      const callbackChat = callbackMessage?.chat as Record<string, unknown> | undefined;
      const callbackFrom = callback.from as Record<string, unknown> | undefined;
      const callbackData = String(callback.data ?? '').trim();
      const chatId = String(callbackChat?.id ?? '');
      const messageId = Number(callbackMessage?.message_id ?? 0) || undefined;
      if (chatId && callbackData) {
        const response = await postChannelControlToApiCore({
          channel: 'telegram',
          peerId: chatId,
          actionId: callbackData,
          messageId: messageId ? String(messageId) : undefined,
          profile: {
            displayName: String(callbackFrom?.first_name ?? ''),
            username: String(callbackFrom?.username ?? ''),
            groupName: String(callbackChat?.title ?? ''),
            peerType: ['group', 'supergroup'].includes(String(callbackChat?.type ?? '')) ? 'group' : 'private',
          },
        });
        await sendTelegramControlResponse(chatId, messageId, response);
        if (callback.id) {
          await telegram.client?.answerCallbackQuery(String(callback.id), response.callbackNotice);
        }
        return reply.code(200).send({ ok: true, handled: true, mode: 'callback' });
      }
    }

    const message = (update.message ?? update.edited_message ?? update.channel_post) as Record<string, unknown> | undefined;
    if (!message) return reply.code(200).send({ ok: true, skipped: true });
    const from = message.from as Record<string, unknown> | undefined;
    const chat = message.chat as Record<string, unknown> | undefined;
    const text = String(message.text ?? '').trim();
    if (!text) return reply.code(200).send({ ok: true, skipped: true });

    const chatId = String(chat?.id ?? '');
    const messageId = Number(message.message_id ?? 0) || undefined;
    if (!chatId) return reply.code(200).send({ ok: true, skipped: true });

    const response = await postChannelControlToApiCore({
      channel: 'telegram',
      peerId: chatId,
      text,
      messageId: messageId ? String(messageId) : undefined,
      profile: {
        displayName: String(from?.first_name ?? ''),
        username: String(from?.username ?? ''),
        groupName: String(chat?.title ?? ''),
        peerType: ['group', 'supergroup'].includes(String(chat?.type ?? '')) ? 'group' : 'private',
      },
    });
    await sendTelegramControlResponse(chatId, messageId, response);
  } catch {
    /* best-effort, Telegram expects 200 */
  }
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
    const allowedGroupIds = parseCsvSet(process.env.WHATSAPP_ALLOWED_GROUP_IDS);
    const entries = (req.body.entry as unknown[]) ?? [];
    for (const rawEntry of entries) {
      const entry = rawEntry as Record<string, unknown>;
      const changes = (entry.changes as unknown[]) ?? [];
      for (const rawChange of changes) {
        const change = rawChange as Record<string, unknown>;
        const value = change.value as Record<string, unknown> | undefined;
        const messages = (value?.messages as Array<Record<string, unknown>>) ?? [];
        const contacts = (value?.contacts as Array<Record<string, unknown>>) ?? [];
        const profileName = String((contacts[0]?.profile as Record<string, unknown> | undefined)?.name ?? '');

        for (const msg of messages) {
          const extracted = extractWhatsAppPeer(msg, profileName);
          if (!extracted) continue;
          if (
            extracted.profile.peerType === 'group' &&
            allowedGroupIds.size > 0 &&
            !allowedGroupIds.has(extracted.peerId)
          ) {
            continue;
          }

          const response = await postChannelControlToApiCore({
            channel: 'whatsapp',
            peerId: extracted.peerId,
            text: extracted.messageText,
            actionId: extracted.actionId,
            profile: extracted.profile,
          });
          await sendWhatsAppControlResponse(extracted.peerId, response, extracted.profile.peerType ?? 'private');
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

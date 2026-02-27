import cors from '@fastify/cors';
import Fastify from 'fastify';
import { createWordPressClientFromEnv } from '@bisp/integrations-wordpress';
import { AssistanceAgent } from '@bisp/agents-assistance';
import { ComplianceAgent } from '@bisp/agents-compliance';
import { ContentAgent } from '@bisp/agents-content';
import { CustomerCareAgent } from '@bisp/agents-customer-care';
import { EnergyAgent } from '@bisp/agents-energy';
import { HardwareAgent } from '@bisp/agents-hardware';
import { PreventiviAgent } from '@bisp/agents-preventivi';
import { TelephonyAgent } from '@bisp/agents-telephony';
import { AssistanceRepository } from '@bisp/domain-assistance';
import { OutboxRepository } from '@bisp/domain-communications';
import { CustomerRepository } from '@bisp/domain-customers';
import { ObjectiveRepository } from '@bisp/domain-objectives';
import { OfferRepository } from '@bisp/domain-offers';
import { DaneaReadOnlyStub } from '@bisp/integrations-danea';
import { ElizaPublishingAdapterStub, InMemoryRAGStore } from '@bisp/integrations-eliza';
import { createLLMClient, type LLMClient } from '@bisp/integrations-llm';
import { EmailChannelAdapter } from '@bisp/integrations-email';
import { MediaGenerationServiceStub } from '@bisp/integrations-media';
import { SocialChannelAdapter } from '@bisp/integrations-social';
import { TelegramChannelAdapter } from '@bisp/integrations-telegram';
import { WhatsAppChannelAdapter } from '@bisp/integrations-whatsapp';
import { CopilotRMOrchestrator } from '@bisp/orchestrator-core';
import { AuditTrail, makeAuditRecord } from '@bisp/shared-audit';
import { PgRuntime } from '@bisp/shared-db';
import type {
  AssistanceTicket,
  CommunicationDraft,
  CustomerProfile,
  DomainEvent,
  ManagerObjective,
  ProductOffer,
  Segment,
  TaskItem,
} from '@bisp/shared-types';
import { loadConfig } from '@bisp/shared-config';
import { ROLE_PERMISSIONS, can, type RbacRole } from '@bisp/shared-rbac';
import { demoCustomers, demoObjectives, demoOffers } from './demoData';
import { AdminSettingsRepository } from './admin/settings';
import { CharacterStudioRepository } from './admin/characters';
import { CampaignRepository, OutboxStore, TaskRepository } from './localRepos';
import type { ChannelDispatchRecord, MediaJobRecord } from './postgresMirror';
import { PostgresMirror } from './postgresMirror';
import { QueueGateway } from './queueGateway';
import { scenarioFactory } from './scenarioFactory';
import {
  buildCampaignTasks,
  buildOneToManyDraftsForOffer,
  buildOneToOneDraftsForOffer,
  buildRagStore,
  consultProposal,
  makeId,
  targetCustomersForOffer,
} from './services';

export interface ApiState {
  assistance: AssistanceRepository;
  campaigns: CampaignRepository;
  customers: CustomerRepository;
  danea: DaneaReadOnlyStub;
  drafts: OutboxStore;
  draftsRaw: OutboxRepository;
  offers: OfferRepository;
  objectives: ObjectiveRepository;
  rag: InMemoryRAGStore;
  audit: AuditTrail;
  adminSettings: AdminSettingsRepository;
  characterStudio: CharacterStudioRepository;
  orchestrator: CopilotRMOrchestrator;
  tasks: TaskRepository;
  channels: {
    telegram: TelegramChannelAdapter;
    email: EmailChannelAdapter;
    social: SocialChannelAdapter;
    whatsapp: WhatsAppChannelAdapter;
    elizaPublishing: ElizaPublishingAdapterStub;
  };
  media: MediaGenerationServiceStub;
  postgresMirror: PostgresMirror;
  queueGateway: QueueGateway;
  llm: LLMClient | null;
}

export function buildState(seed?: { customers?: CustomerProfile[]; offers?: ProductOffer[]; objectives?: ManagerObjective[] }): ApiState {
  const assistance = new AssistanceRepository();
  const campaigns = new CampaignRepository();
  const customers = new CustomerRepository();
  const danea = new DaneaReadOnlyStub();
  const drafts = new OutboxStore();
  const draftsRaw = new OutboxRepository();
  const offers = new OfferRepository();
  const objectives = new ObjectiveRepository();
  const tasks = new TaskRepository();
  const audit = new AuditTrail();
  const adminSettings = new AdminSettingsRepository();
  const characterStudio = new CharacterStudioRepository();
  const postgresMirror = new PostgresMirror({
    enabled: /^(postgres|hybrid)$/i.test(process.env.BISPCRM_PERSISTENCE_MODE ?? 'memory'),
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/copilotrm',
  });
  const queueGateway = new QueueGateway(
    /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline',
    process.env.REDIS_URL ?? 'redis://localhost:6379'
  );

  // LLM client — local-first con cloud fallback; null se nessun provider configurato
  let llm: LLMClient | null = null;
  try {
    const appConfig = loadConfig();
    llm = createLLMClient(appConfig.llm);
  } catch {
    // fallback graceful: sistema funziona con template string
  }

  for (const c of seed?.customers ?? demoCustomers) customers.upsert(c);
  for (const o of seed?.offers ?? demoOffers) offers.upsert(o);
  for (const obj of seed?.objectives ?? demoObjectives) objectives.upsert(obj);
  const rag = buildRagStore(customers.list(), offers.listActive());
  customers.list().forEach((c) => void postgresMirror.saveCustomer(c));
  offers.listAll().forEach((o) => void postgresMirror.saveOffer(o));
  objectives.listAll().forEach((o) => void postgresMirror.saveObjective(o));

  const orchestrator = new CopilotRMOrchestrator([
    new AssistanceAgent(),
    new PreventiviAgent(),
    new TelephonyAgent(),
    new EnergyAgent(),
    new HardwareAgent(),
    new CustomerCareAgent(),
    new ContentAgent(),
    new ComplianceAgent(),
  ]);

  return {
    assistance,
    campaigns,
    customers,
    danea,
    drafts,
    draftsRaw,
    offers,
    objectives,
    rag,
    audit,
    adminSettings,
    characterStudio,
    orchestrator,
    tasks,
    channels: {
      telegram: new TelegramChannelAdapter(),
      email: new EmailChannelAdapter(),
      social: new SocialChannelAdapter(),
      whatsapp: new WhatsAppChannelAdapter(),
      elizaPublishing: new ElizaPublishingAdapterStub(),
    },
    media: new MediaGenerationServiceStub(),
    postgresMirror,
    queueGateway,
    llm,
  };
}

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return /^(1|true|yes|on)$/i.test(raw);
}

function persistOperationalOutput(state: ApiState, output: { tasks: TaskItem[]; drafts: CommunicationDraft[]; auditRecords: ReturnType<AuditTrail['list']> }) {
  state.tasks.addMany(output.tasks);
  const outboxItems = output.drafts.map((d) => {
    const item = state.drafts.addDraft(d);
    state.draftsRaw.add(d);
    return item;
  });
  output.auditRecords.forEach((r) => state.audit.write(r));
  void state.postgresMirror.saveTasks(output.tasks);
  void state.postgresMirror.saveOutbox(outboxItems);
  void state.postgresMirror.saveAudit(output.auditRecords);
  if (envFlag('BISPCRM_QUEUE_CONTENT_TASKS', false)) {
    output.tasks
      .filter((t) => t.kind === 'content')
      .forEach((t) =>
        void state.queueGateway.enqueueContent({
          taskId: t.id,
          title: t.title,
          offerId: t.offerId ?? null,
          priority: t.priority,
        })
      );
  }
}

function resolveOfferFromRequest(
  state: ApiState,
  body: { offerId?: string; offerTitle?: string }
): ProductOffer | undefined {
  if (body.offerId) {
    if (body.offerId.includes('<') || body.offerId.includes('>')) return undefined;
    return state.offers.getById(body.offerId);
  }
  if (body.offerTitle) {
    const needle = body.offerTitle.trim().toLowerCase();
    return state.offers.listActive().find((o) => o.title.toLowerCase().includes(needle));
  }
  return undefined;
}

function buildChannelDispatchRecord(params: {
  draftId?: string;
  channel: string;
  status: 'queued' | 'sent' | 'failed';
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  error?: string;
}): ChannelDispatchRecord {
  const now = new Date().toISOString();
  return {
    id: makeId('dispatch'),
    source: 'api-core',
    draftId: params.draftId,
    channel: params.channel,
    status: params.status,
    requestPayload: params.requestPayload,
    responsePayload: params.responsePayload,
    error: params.error,
    createdAt: now,
    sentAt: params.status === 'failed' ? undefined : now,
  };
}

export function buildServer(state = buildState()) {
  const app = Fastify({ logger: { level: 'info' } });
  const authMode = (process.env.BISPCRM_AUTH_MODE ?? 'header') as 'none' | 'header';
  const authEnabled = authMode === 'header';
  const resolveRole = (headers: Record<string, unknown>): RbacRole => {
    const raw = String(headers['x-bisp-role'] ?? 'viewer');
    const role = raw as RbacRole;
    return role in ROLE_PERMISSIONS ? role : 'viewer';
  };
  const ensurePermission = (
    req: { headers: Record<string, unknown> },
    reply: { code: (code: number) => { send: (payload: unknown) => unknown } },
    permission: string
  ): RbacRole | null => {
    if (authEnabled && !req.headers['x-bisp-role']) {
      reply.code(401).send({ error: 'Missing x-bisp-role header', authMode });
      return null;
    }
    const role = resolveRole(req.headers);
    if (!authEnabled) return role;
    if (can(role, permission)) return role;
    reply.code(403).send({ error: 'Forbidden', role, permission, authMode });
    return null;
  };
  void app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-bisp-role', 'Accept'],
    exposedHeaders: ['x-bisp-role'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  app.addHook('onReady', async () => {
    const shouldAutoLoad = envFlag(
      'BISPCRM_AUTO_LOAD_RUNTIME',
      /^(postgres|hybrid)$/i.test(process.env.BISPCRM_PERSISTENCE_MODE ?? 'memory')
    );
    if (!shouldAutoLoad) return;
    const [customers, tickets, offers, objectives, tasks, outbox, campaigns, settings] = await Promise.all([
      state.postgresMirror.loadCustomers(),
      state.postgresMirror.loadTickets(),
      state.postgresMirror.loadOffers(),
      state.postgresMirror.loadObjectives(),
      state.postgresMirror.loadTasks(),
      state.postgresMirror.loadOutbox(),
      state.postgresMirror.loadCampaigns(),
      state.postgresMirror.loadAdminSettings(),
    ]);
    if (customers.length) state.customers.replaceAll(customers);
    if (tickets.length) state.assistance.replaceAll(tickets);
    if (offers.length) state.offers.replaceAll(offers);
    if (objectives.length) state.objectives.replaceAll(objectives);
    if (tasks.length) state.tasks.replaceAll(tasks);
    if (outbox.length) state.drafts.replaceAll(outbox);
    if (campaigns.length) state.campaigns.replaceAll(campaigns);
    if (settings.length) state.adminSettings.replaceAll(settings);
    state.rag = buildRagStore(state.customers.list(), state.offers.listActive());
    state.audit.write(
      makeAuditRecord('system', 'db.auto_load_runtime', {
        customers: customers.length,
        tickets: tickets.length,
        offers: offers.length,
        objectives: objectives.length,
        tasks: tasks.length,
        outbox: outbox.length,
        campaigns: campaigns.length,
        settings: settings.length,
      })
    );
  });
  app.addHook('onClose', async () => {
    if (envFlag('BISPCRM_AUTO_SYNC_ON_CLOSE', false)) {
      await Promise.all(state.customers.list().map((c) => state.postgresMirror.saveCustomer(c)));
      await Promise.all(state.assistance.list().map((t) => state.postgresMirror.saveTicket(t)));
      await Promise.all(state.offers.listAll().map((o) => state.postgresMirror.saveOffer(o)));
      await Promise.all(state.objectives.listAll().map((o) => state.postgresMirror.saveObjective(o)));
      await Promise.all(state.tasks.list().map((t) => state.postgresMirror.saveTasks([t])));
      await Promise.all(state.drafts.list().map((o) => state.postgresMirror.saveOutbox([o])));
      await Promise.all(state.campaigns.list().map((c) => state.postgresMirror.saveCampaign(c)));
      await Promise.all(state.adminSettings.list({ masked: false }).map((s) => state.postgresMirror.saveAdminSetting(s)));
    }
    await state.queueGateway.close().catch(() => undefined);
    await state.postgresMirror.close().catch(() => undefined);
  });

  app.get('/health', async () => ({ ok: true, service: 'api-core', ts: new Date().toISOString() }));

  app.get('/api/customers', async () => state.customers.list());
  app.get('/api/datahub/overview', async () => {
    const customers = state.customers.list();
    const offers = state.offers.listAll();
    const tickets = state.assistance.list();
    const objectives = state.objectives.listAll();
    const outbox = state.drafts.list();
    const segments = customers.reduce<Record<string, number>>((acc, c) => {
      c.segments.forEach((s) => { acc[s] = (acc[s] ?? 0) + 1; });
      return acc;
    }, {});
    return {
      customers: customers.length,
      offers: { total: offers.length, active: offers.filter((o) => o.active).length },
      tickets: { total: tickets.length, open: tickets.filter((t) => t.outcome === 'pending').length },
      objectives: { total: objectives.length, active: objectives.filter((o) => o.active).length },
      outbox: { total: outbox.length, pendingApproval: outbox.filter((o) => o.status === 'pending-approval').length },
      segments,
    };
  });
  app.get<{ Params: { customerId: string } }>('/api/datahub/customers/:customerId', async (req, reply) => {
    const customer = state.customers.getById(req.params.customerId);
    if (!customer) return reply.code(404).send({ error: 'Customer not found' });
    const tickets = state.assistance.list().filter((t) => t.customerId === customer.id || t.phoneLookup === customer.phone);
    const tasks = state.tasks.list().filter((t) => t.customerId === customer.id);
    const outbox = state.drafts.list().filter((o) => o.draft.customerId === customer.id);
    const ragHints = state.rag.search(`${customer.fullName} ${customer.interests.join(' ')} ${customer.segments.join(' ')}`, 6);
    return { customer, tickets, tasks, outbox, ragHints };
  });
  app.get<{ Querystring: { q: string } }>('/api/datahub/search', async (req, reply) => {
    const q = req.query.q?.trim().toLowerCase();
    if (!q) return reply.code(400).send({ error: 'q is required' });
    const customers = state.customers.list().filter((c) =>
      c.fullName.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.segments.some((s) => s.toLowerCase().includes(q))
    );
    const offers = state.offers.listAll().filter((o) =>
      o.title.toLowerCase().includes(q) || o.category.toLowerCase().includes(q)
    );
    return { q, customers, offers };
  });
  app.get('/api/assist/tickets', async () => state.assistance.list());
  app.get<{ Querystring: { category?: ProductOffer['category']; q?: string } }>('/api/offers', async (req) => {
    let offers = state.offers.listActive();
    if (req.query.category) offers = offers.filter((o) => o.category === req.query.category);
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      offers = offers.filter((o) => o.title.toLowerCase().includes(q));
    }
    return offers;
  });
  app.get('/api/objectives', async () => state.objectives.listActive());
  app.get<{ Querystring: { type?: string; actor?: string } }>('/api/audit', async (req) => {
    let records = state.audit.list();
    if (req.query.type) records = records.filter((r) => r.type === req.query.type);
    if (req.query.actor) records = records.filter((r) => r.actor === req.query.actor);
    return records;
  });
  app.get<{ Querystring: { status?: TaskItem['status']; kind?: TaskItem['kind'] } }>('/api/tasks', async (req, reply) => {
    if (ensurePermission(req, reply, 'tasks:read') === null) return;
    return state.tasks.list({ status: req.query.status, kind: req.query.kind });
  });
  app.patch<{ Params: { taskId: string }; Body: Partial<Pick<TaskItem, 'status' | 'assigneeRole' | 'priority'>> }>(
    '/api/tasks/:taskId',
    async (req, reply) => {
      if (ensurePermission(req, reply, 'tasks:update') === null) return;
      const task = state.tasks.update(req.params.taskId, req.body);
      if (!task) return reply.code(404).send({ error: 'Task not found' });
      state.audit.write(makeAuditRecord('task-center', 'task.updated', { taskId: task.id, patch: req.body }));
      void state.postgresMirror.saveTasks([task]);
      return task;
    }
  );
  app.get<{
    Querystring: { status?: 'pending-approval' | 'approved' | 'queued' | 'sent' | 'rejected'; channel?: CommunicationDraft['channel'] };
  }>('/api/outbox', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:read') === null) return;
    return state.drafts.list({ status: req.query.status, channel: req.query.channel });
  });

  app.post<{ Params: { outboxId: string }; Body: { actor?: string } }>('/api/outbox/:outboxId/approve', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:approve') === null) return;
    const item = state.drafts.getById(req.params.outboxId);
    if (!item) return reply.code(404).send({ error: 'Outbox item not found' });
    const approved = state.drafts.update(item.id, {
      status: 'approved',
      approvedBy: req.body.actor ?? 'manager',
      approvedAt: new Date().toISOString(),
    });
    state.audit.write(makeAuditRecord('manager', 'outbox.approved', { outboxId: item.id, actor: req.body.actor ?? 'manager' }));
    if (approved) void state.postgresMirror.saveOutbox([approved]);
    return approved;
  });

  app.post<{ Params: { outboxId: string }; Body: { actor?: string; reason?: string } }>('/api/outbox/:outboxId/reject', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:approve') === null) return;
    const item = state.drafts.getById(req.params.outboxId);
    if (!item) return reply.code(404).send({ error: 'Outbox item not found' });
    const rejected = state.drafts.update(item.id, {
      status: 'rejected',
      rejectedBy: req.body.actor ?? 'manager',
      rejectedAt: new Date().toISOString(),
    });
    state.audit.write(makeAuditRecord('manager', 'outbox.rejected', { outboxId: item.id, actor: req.body.actor ?? 'manager', reason: req.body.reason ?? null }));
    if (rejected) void state.postgresMirror.saveOutbox([rejected]);
    return rejected;
  });

  app.post<{ Params: { outboxId: string } }>('/api/outbox/:outboxId/send', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:approve') === null) return;
    const item = state.drafts.getById(req.params.outboxId);
    if (!item) return reply.code(404).send({ error: 'Outbox item not found' });
    if (item.status === 'pending-approval') return reply.code(409).send({ error: 'Approval required' });

    const queueSend = /^(1|true|yes|on)$/i.test(String(process.env.BISPCRM_QUEUE_SEND_OUTBOX ?? 'false'));
    if (queueSend) {
      const queued = await state.queueGateway.enqueueSocial(item.draft);
      const queuedExternalId = queued.jobId ? `bullmq:${queued.queue}:${queued.jobId}` : undefined;
      const updatedQueued = state.drafts.update(item.id, { status: 'queued', externalId: queuedExternalId, sentAt: new Date().toISOString() });
      state.audit.write(makeAuditRecord('channel-gateway', 'outbox.queued', { outboxId: item.id, mode: queued.mode, queue: queued.queue ?? null, jobId: queued.jobId ?? null }));
      if (updatedQueued) void state.postgresMirror.saveOutbox([updatedQueued]);
      void state.postgresMirror.saveChannelDispatch(
        buildChannelDispatchRecord({
          draftId: item.id,
          channel: item.draft.channel,
          status: 'queued',
          requestPayload: { draft: item.draft },
          responsePayload: { mode: queued.mode, queue: queued.queue ?? null, jobId: queued.jobId ?? null },
        })
      );
      return updatedQueued;
    }

    try {
      let externalId = '';
      let providerResult: Record<string, unknown> = {};
      if (item.draft.channel === 'telegram') {
        const res = await state.channels.telegram.queueOfferMessage(item.draft);
        externalId = `telegram_${String(res.queued)}`;
        providerResult = { queued: res.queued };
      } else if (item.draft.channel === 'email') {
        const res = await state.channels.email.sendOrQueue(item.draft);
        externalId = `email_${res.status}`;
        providerResult = { status: res.status };
      } else if (item.draft.channel === 'whatsapp') {
        const res = await state.channels.whatsapp.sendOrQueue(item.draft);
        externalId = res.messageId ?? `wa_${item.draft.id}`;
        providerResult = { status: res.status, messageId: res.messageId };
      } else if (['facebook', 'instagram', 'x'].includes(item.draft.channel)) {
        const res = await state.channels.social.publish(item.draft);
        externalId = `social_${res.platform}`;
        providerResult = { queued: res.queued, platform: res.platform };
      } else {
        const res = await state.channels.elizaPublishing.publish(item.draft);
        externalId = res.externalId;
        providerResult = { externalId: res.externalId, status: res.status };
      }

      const status = item.draft.needsApproval ? 'queued' : 'sent';
      const updated = state.drafts.update(item.id, { status, externalId, sentAt: new Date().toISOString() });
      state.audit.write(makeAuditRecord('channel-gateway', 'outbox.sent', { outboxId: item.id, channel: item.draft.channel, status, externalId }));
      if (updated) void state.postgresMirror.saveOutbox([updated]);
      void state.postgresMirror.saveChannelDispatch(
        buildChannelDispatchRecord({
          draftId: item.id,
          channel: item.draft.channel,
          status,
          requestPayload: { draft: item.draft },
          responsePayload: { externalId, ...providerResult },
        })
      );
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.audit.write(makeAuditRecord('channel-gateway', 'outbox.send.failed', { outboxId: item.id, channel: item.draft.channel, error: message }));
      void state.postgresMirror.saveChannelDispatch(
        buildChannelDispatchRecord({
          draftId: item.id,
          channel: item.draft.channel,
          status: 'failed',
          requestPayload: { draft: item.draft },
          responsePayload: {},
          error: message,
        })
      );
      return reply.code(502).send({ error: 'Channel send failed', detail: message });
    }
  });
  app.post<{ Params: { outboxId: string }; Body: { actor?: string } }>('/api/outbox/:outboxId/approve-send', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:approve') === null) return;
    const item = state.drafts.getById(req.params.outboxId);
    if (!item) return reply.code(404).send({ error: 'Outbox item not found' });
    if (item.status === 'pending-approval') {
      state.drafts.update(item.id, {
        status: 'approved',
        approvedBy: req.body.actor ?? 'manager',
        approvedAt: new Date().toISOString(),
      });
      state.audit.write(makeAuditRecord('manager', 'outbox.approved', { outboxId: item.id, actor: req.body.actor ?? 'manager' }));
    }
    try {
      let externalId = '';
      let providerResult: Record<string, unknown> = {};
      if (item.draft.channel === 'telegram') {
        const res = await state.channels.telegram.queueOfferMessage(item.draft);
        externalId = `telegram_${String(res.queued)}`;
        providerResult = { queued: res.queued };
      } else if (item.draft.channel === 'email') {
        const res = await state.channels.email.sendOrQueue(item.draft);
        externalId = `email_${res.status}`;
        providerResult = { status: res.status };
      } else if (item.draft.channel === 'whatsapp') {
        const res = await state.channels.whatsapp.sendOrQueue(item.draft);
        externalId = res.messageId ?? `wa_${item.draft.id}`;
        providerResult = { status: res.status, messageId: res.messageId };
      } else if (['facebook', 'instagram', 'x'].includes(item.draft.channel)) {
        const res = await state.channels.social.publish(item.draft);
        externalId = `social_${res.platform}`;
        providerResult = { queued: res.queued, platform: res.platform };
      } else {
        const res = await state.channels.elizaPublishing.publish(item.draft);
        externalId = res.externalId;
        providerResult = { externalId: res.externalId, status: res.status };
      }
      const updated = state.drafts.update(item.id, { status: 'queued', externalId, sentAt: new Date().toISOString() });
      state.audit.write(makeAuditRecord('channel-gateway', 'outbox.sent', { outboxId: item.id, channel: item.draft.channel, status: 'queued', externalId }));
      if (updated) void state.postgresMirror.saveOutbox([updated]);
      void state.postgresMirror.saveChannelDispatch(
        buildChannelDispatchRecord({
          draftId: item.id,
          channel: item.draft.channel,
          status: 'queued',
          requestPayload: { draft: item.draft },
          responsePayload: { externalId, ...providerResult },
        })
      );
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.audit.write(makeAuditRecord('channel-gateway', 'outbox.send.failed', { outboxId: item.id, channel: item.draft.channel, error: message }));
      void state.postgresMirror.saveChannelDispatch(
        buildChannelDispatchRecord({
          draftId: item.id,
          channel: item.draft.channel,
          status: 'failed',
          requestPayload: { draft: item.draft },
          responsePayload: {},
          error: message,
        })
      );
      return reply.code(502).send({ error: 'Channel send failed', detail: message });
    }
  });

  app.get('/api/campaigns', async () => state.campaigns.list());
  app.get('/api/swarm/capabilities', async () => ({
    agents: [
      { id: 'assistance', enabled: true },
      { id: 'preventivi', enabled: true },
      { id: 'telephony', enabled: true },
      { id: 'energy', enabled: true },
      { id: 'hardware', enabled: true },
      { id: 'customer-care', enabled: true },
      { id: 'content', enabled: true },
      { id: 'compliance', enabled: true },
    ],
    characters: state.characterStudio.list().map((c) => ({ key: c.key, enabled: c.enabled, modelTier: c.modelTier, channels: c.channels })),
    queueMode: state.queueGateway.getMode(),
    orchestrator: 'rule-scoring-handoff',
  }));
  app.post<{
    Body: { eventType: DomainEvent['type']; customerId?: string; payload?: Record<string, unknown> };
  }>('/api/swarm/simulate', async (req, reply) => {
    const event: DomainEvent = {
      id: makeId('evt'),
      type: req.body.eventType,
      occurredAt: new Date().toISOString(),
      customerId: req.body.customerId,
      payload: req.body.payload ?? {},
    };
    const customer = event.customerId ? state.customers.getById(event.customerId) : undefined;
    const output = state.orchestrator.run({
      event,
      customer,
      activeObjectives: state.objectives.listActive(),
      activeOffers: state.offers.listActive(),
      now: new Date().toISOString(),
    });
    persistOperationalOutput(state, output);
    return reply.code(201).send({ event, output });
  });
  app.get('/api/swarm/runs', async () => {
    const records = state.audit.list().filter((r) =>
      ['event.received', 'actions.ranked', 'handoffs.derived', 'agents.executed'].includes(r.type)
    );
    return records.slice(-200).reverse();
  });
  app.get('/api/system/db/snapshot', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const counts = await state.postgresMirror.snapshotCounts();
    return { counts };
  });
  app.post('/api/system/db/sync-runtime', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const customers = state.customers.list();
    const tickets = state.assistance.list();
    const offers = state.offers.listAll();
    const objectives = state.objectives.listAll();
    const tasks = state.tasks.list();
    const outbox = state.drafts.list();
    const campaigns = state.campaigns.list();
    const settings = state.adminSettings.list({ masked: false });
    await Promise.all(customers.map((c) => state.postgresMirror.saveCustomer(c)));
    await Promise.all(tickets.map((t) => state.postgresMirror.saveTicket(t)));
    await Promise.all(offers.map((o) => state.postgresMirror.saveOffer(o)));
    await Promise.all(objectives.map((o) => state.postgresMirror.saveObjective(o)));
    await Promise.all(tasks.map((t) => state.postgresMirror.saveTasks([t])));
    await Promise.all(outbox.map((o) => state.postgresMirror.saveOutbox([o])));
    await Promise.all(campaigns.map((c) => state.postgresMirror.saveCampaign(c)));
    await Promise.all(settings.map((s) => state.postgresMirror.saveAdminSetting(s)));
    const counts = await state.postgresMirror.snapshotCounts();
    state.audit.write(makeAuditRecord('system', 'db.sync_runtime', { counts }));
    return { ok: true, counts };
  });
  app.post('/api/system/db/load-runtime', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const [customers, tickets, offers, objectives, tasks, outbox, campaigns, settings] = await Promise.all([
      state.postgresMirror.loadCustomers(),
      state.postgresMirror.loadTickets(),
      state.postgresMirror.loadOffers(),
      state.postgresMirror.loadObjectives(),
      state.postgresMirror.loadTasks(),
      state.postgresMirror.loadOutbox(),
      state.postgresMirror.loadCampaigns(),
      state.postgresMirror.loadAdminSettings(),
    ]);
    if (customers.length) state.customers.replaceAll(customers);
    if (tickets.length) state.assistance.replaceAll(tickets);
    if (offers.length) state.offers.replaceAll(offers);
    if (objectives.length) state.objectives.replaceAll(objectives);
    if (tasks.length) state.tasks.replaceAll(tasks);
    if (outbox.length) state.drafts.replaceAll(outbox);
    if (campaigns.length) state.campaigns.replaceAll(campaigns);
    if (settings.length) state.adminSettings.replaceAll(settings);
    state.rag = buildRagStore(state.customers.list(), state.offers.listActive());
    state.audit.write(makeAuditRecord('system', 'db.load_runtime', {
      customers: customers.length,
      tickets: tickets.length,
      offers: offers.length,
      objectives: objectives.length,
      tasks: tasks.length,
      outbox: outbox.length,
      campaigns: campaigns.length,
      settings: settings.length,
    }));
    return {
      ok: true,
      loaded: {
        customers: customers.length,
        tickets: tickets.length,
        offers: offers.length,
        objectives: objectives.length,
        tasks: tasks.length,
        outbox: outbox.length,
        campaigns: campaigns.length,
        settings: settings.length,
      },
    };
  });
  app.post<{ Body: { queue?: 'orchestrator-events' | 'content-jobs' | 'social-publish' | 'media-jobs'; payload?: unknown } }>('/api/system/queue/enqueue-test', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const queueName = req.body.queue ?? 'orchestrator-events';
    if (queueName === 'orchestrator-events') return state.queueGateway.enqueueOrchestrator(req.body.payload ?? { ping: true, ts: new Date().toISOString() });
    if (queueName === 'content-jobs') return state.queueGateway.enqueueContent(req.body.payload ?? { prompt: 'test content prompt' });
    if (queueName === 'media-jobs') return state.queueGateway.enqueueMedia(req.body.payload ?? { kind: 'text', title: 'queue test', brief: 'queue media job test' });
    return state.queueGateway.enqueueSocial((req.body.payload as CommunicationDraft) ?? {
      id: `draft_test_${Date.now()}`,
      channel: 'telegram',
      audience: 'one-to-many',
      body: 'Test social queue',
      needsApproval: false,
      reason: 'system queue test',
    });
  });
  app.get('/api/system/infra', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const pg = new PgRuntime({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/copilotrm' });
    const db = await pg.health().catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    await pg.close().catch(() => undefined);
    const redisConfigured = Boolean(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const mirror = await state.postgresMirror.health();
    const queue = await state.queueGateway.snapshot();
    return {
      postgres: db,
      postgresMirror: mirror,
      redis: { configured: redisConfigured, url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
      queue,
      queues: ['orchestrator-events', 'content-jobs', 'social-publish', 'media-jobs'],
      persistenceMode: process.env.BISPCRM_PERSISTENCE_MODE ?? 'memory',
    };
  });
  app.post('/api/system/db/migrate', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const pg = new PgRuntime({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/copilotrm' });
    try {
      const result = await pg.runMigrations();
      state.audit.write(makeAuditRecord('system', 'db.migrations.run', result));
      return { ok: true, ...result };
    } finally {
      await pg.close().catch(() => undefined);
    }
  });
  app.get<{ Querystring: { category?: 'models' | 'channels' | 'autoposting' | 'agents' | 'system'; includeSecrets?: 'true' | 'false' } }>(
    '/api/admin/settings',
    async (req, reply) => {
      if (ensurePermission(req, reply, 'settings:write') === null) return;
      const masked = req.query.includeSecrets === 'true' ? false : true;
      return {
        updatedAt: state.adminSettings.snapshot({ masked }).updatedAt,
        items: state.adminSettings.list({ masked, category: req.query.category }),
      };
    }
  );
  app.get<{ Params: { key: string } }>('/api/admin/settings/:key', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const item = state.adminSettings.get(req.params.key);
    if (!item) return reply.code(404).send({ error: 'Setting not found' });
    return item;
  });
  app.patch<{ Params: { key: string }; Body: { value: unknown; persist?: boolean } }>('/api/admin/settings/:key', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const current = state.adminSettings.get(req.params.key, { masked: false });
    if (!current) return reply.code(404).send({ error: 'Setting not found' });
    const next = state.adminSettings.upsert(req.params.key, req.body.value as never);
    if (req.body.persist) state.adminSettings.persist();
    state.audit.write(makeAuditRecord('admin-settings', 'setting.updated', { key: req.params.key, persist: Boolean(req.body.persist) }));
    void state.postgresMirror.saveAdminSetting(next);
    return { ...next, value: current.type === 'secret' ? 'updated' : next.value };
  });
  app.get('/api/admin/characters', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return state.characterStudio.list();
  });
  app.get<{ Params: { key: string } }>('/api/admin/characters/:key', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const character = state.characterStudio.get(req.params.key);
    if (!character) return reply.code(404).send({ error: 'Character not found' });
    return character;
  });
  app.patch<{
    Params: { key: string };
    Body: {
      name?: string;
      role?: string;
      tone?: string[];
      goals?: string[];
      limits?: string[];
      channels?: string[];
      style?: string[];
      enabled?: boolean;
      modelTier?: 'small' | 'medium' | 'large';
      systemInstructions?: string;
      apiSources?: string[];
      persist?: boolean;
    };
  }>('/api/admin/characters/:key', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const next = state.characterStudio.upsert(req.params.key, req.body);
    if (req.body.persist) state.characterStudio.persist();
    state.audit.write(makeAuditRecord('character-studio', 'character.updated', { key: req.params.key, persist: Boolean(req.body.persist) }));
    return next;
  });
  app.get<{ Params: { key: string } }>('/api/admin/characters/:key/eliza-preview', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const preview = state.characterStudio.toElizaLike(req.params.key);
    if (!preview) return reply.code(404).send({ error: 'Character not found' });
    return preview;
  });
  app.get('/api/admin/agents', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const items = state.adminSettings.list({ category: 'agents' });
    return items.map((i) => ({ key: i.key, enabled: Boolean(i.value), source: i.source, description: i.description }));
  });
  app.get('/api/admin/models', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return state.adminSettings.list({ category: 'models' });
  });
  app.get('/api/admin/model-catalog', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return ({
    local: [
      { provider: 'ollama', models: ['gemma3:27b', 'deepseek-r1:32b', 'mxbai-embed-large'], kind: ['chat', 'reasoning', 'embedding'] },
      { provider: 'lmstudio', models: ['custom-local'], kind: ['chat'] },
    ],
    cloud: [
      { provider: 'openai', models: ['gpt-4.1-mini', 'gpt-4.1', 'text-embedding-3-small'], kind: ['chat', 'embedding'] },
      { provider: 'deepseek', models: ['deepseek-chat'], kind: ['chat'] },
      { provider: 'google', models: ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'], kind: ['chat', 'embedding'] },
    ],
    strategy: 'local-first with fallback API providers',
  });
  });
  app.get('/api/admin/channels', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return [
      ...state.adminSettings.list({ category: 'channels' }),
      ...state.adminSettings.list({ category: 'autoposting' }),
    ];
  });
  app.get('/api/admin/rbac', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return ({
    authEnabled,
    mode: authEnabled ? 'header-role' : 'preview-rbac-matrix',
    roles: ROLE_PERMISSIONS,
  });
  });
  app.get('/api/admin/integrations', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return {
      adapters: {
        danea: { mode: 'read-only-stub', enabled: true },
        eliza: { mode: 'adapter', enabled: true },
        telegram: { mode: 'stub', enabled: true },
        email: { mode: 'stub', enabled: true },
        whatsapp: { mode: 'stub', enabled: true },
        social: { mode: 'stub', enabled: true },
        media: { mode: 'service-layer-stub', enabled: true },
      },
      queue: await state.queueGateway.snapshot(),
      persistence: await state.postgresMirror.health(),
    };
  });
  app.get('/api/channels/dispatches', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:read') === null) return;
    return state.postgresMirror.loadChannelDispatches(200);
  });
  app.get('/api/media/jobs', async (req, reply) => {
    if (ensurePermission(req, reply, 'tasks:read') === null) return;
    return state.postgresMirror.loadMediaJobs(200);
  });
  app.post<{
    Body: {
      kind: 'text' | 'voice-script' | 'avatar-video' | 'podcast';
      title: string;
      brief: string;
      channel?: 'blog' | 'facebook' | 'instagram' | 'x' | 'telegram' | 'whatsapp';
    };
  }>('/api/media/generate', async (req, reply) => {
    if (ensurePermission(req, reply, 'tasks:update') === null) return;
    if (!req.body.title || !req.body.brief) return reply.code(400).send({ error: 'title and brief are required' });
    const mediaJob: MediaJobRecord = {
      id: makeId('media'),
      kind: req.body.kind,
      title: req.body.title,
      brief: req.body.brief,
      channel: req.body.channel,
      status: 'processing',
      requestPayload: req.body as unknown as Record<string, unknown>,
      createdBy: String(req.headers['x-bisp-role'] ?? 'system'),
      createdAt: new Date().toISOString(),
    };
    void state.postgresMirror.saveMediaJob(mediaJob);
    const queueMedia = envFlag('BISPCRM_QUEUE_MEDIA_JOBS', false);
    if (queueMedia) {
      const queued = await state.queueGateway.enqueueMedia(mediaJob);
      const queuedJob: MediaJobRecord = {
        ...mediaJob,
        status: 'queued',
        resultPayload: {
          mode: queued.mode,
          queue: queued.queue ?? null,
          jobId: queued.jobId ?? null,
        },
      };
      void state.postgresMirror.saveMediaJob(queuedJob);
      state.audit.write(makeAuditRecord('media-service', 'media.job.queued', { id: mediaJob.id, kind: mediaJob.kind, queue: queued.queue ?? null, jobId: queued.jobId ?? null }));
      return reply.code(202).send({ job: queuedJob });
    }
    try {
      const result = await state.media.generate(req.body);
      const completed: MediaJobRecord = {
        ...mediaJob,
        status: 'completed',
        resultPayload: result as unknown as Record<string, unknown>,
        processedAt: new Date().toISOString(),
      };
      void state.postgresMirror.saveMediaJob(completed);
      state.audit.write(makeAuditRecord('media-service', 'media.generated', { id: mediaJob.id, kind: req.body.kind, title: req.body.title, channel: req.body.channel ?? null }));
      return reply.code(201).send({ job: completed, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: MediaJobRecord = {
        ...mediaJob,
        status: 'failed',
        error: message,
        processedAt: new Date().toISOString(),
      };
      void state.postgresMirror.saveMediaJob(failed);
      state.audit.write(makeAuditRecord('media-service', 'media.failed', { id: mediaJob.id, error: message }));
      return reply.code(500).send({ error: 'Media generation failed', detail: message, job: failed });
    }
  });

  app.get<{ Querystring: { phone?: string } }>('/api/assist/customers/lookup', async (req, reply) => {
    const phone = req.query.phone?.trim();
    if (!phone) return reply.code(400).send({ error: 'phone query param required' });
    const customer = state.customers.findByPhone(phone);
    state.audit.write(
      makeAuditRecord('assist-desk', 'assist.lookup.phone', {
        phone,
        found: Boolean(customer),
        customerId: customer?.id,
      })
    );
    return {
      found: Boolean(customer),
      customer: customer ?? null,
      mode: customer ? 'existing-customer' : 'provisional-customer-required',
      rule: 'No master customer creation from assist desk',
    };
  });

  app.post<{
    Body: {
      phone: string;
      deviceType: string;
      issue: string;
      customerId?: string;
      inferredSignals?: string[];
      // Extended NLP fields
      customerName?: string;
      customerEmail?: string;
      brand?: string;
      model?: string;
      serialNumber?: string;
      hasWarranty?: boolean;
      estimatedPrice?: number;
      ticketNotes?: string;
    };
  }>('/api/assist/tickets', async (req, reply) => {
    const {
      phone, deviceType, issue, customerId, inferredSignals = [],
      customerName, customerEmail, brand, model, serialNumber,
      hasWarranty, estimatedPrice, ticketNotes,
    } = req.body;
    if (!phone || !deviceType || !issue) {
      return reply.code(400).send({ error: 'phone, deviceType, issue are required' });
    }

    const matchedCustomer = customerId
      ? state.customers.getById(customerId)
      : state.customers.findByPhone(phone);

    const now = new Date().toISOString();
    const ticket: AssistanceTicket = {
      id: makeId('ticket'),
      customerId: matchedCustomer?.id,
      provisionalCustomer: !matchedCustomer,
      phoneLookup: phone,
      deviceType,
      issue,
      outcome: 'pending',
      inferredSignals,
      createdAt: now,
      updatedAt: now,
      customerName,
      customerEmail,
      brand,
      model,
      serialNumber,
      hasWarranty,
      estimatedPrice,
      ticketNotes,
    };

    state.assistance.upsert(ticket);
    void state.postgresMirror.saveTicket(ticket);
    state.audit.write(
      makeAuditRecord('assist-desk', 'assist.ticket.created', {
        ticketId: ticket.id,
        customerId: ticket.customerId ?? null,
        provisionalCustomer: ticket.provisionalCustomer,
        phoneLookup: ticket.phoneLookup,
        rule: ticket.provisionalCustomer
          ? 'Created provisional internal ticket only (no master customer)'
          : 'Linked to existing customer',
      })
    );

    return reply.code(201).send({
      ticket,
      customer: matchedCustomer ?? null,
      provisionalCustomerNotice: ticket.provisionalCustomer
        ? 'Cliente non trovato: creato ticket con cliente provvisorio interno. Nessuna anagrafica master creata.'
        : null,
    });
  });

  app.post<{
    Body: {
      channel: 'email' | 'whatsapp';
      from: string;
      subject?: string;
      body: string;
      customerId?: string;
      phone?: string;
      email?: string;
    };
  }>('/api/inbound/message', async (req, reply) => {
    const permission = req.body.channel === 'email' ? 'inbound:read' : 'inbound:read';
    if (ensurePermission(req, reply, permission) === null) return;
    if (!req.body.from || !req.body.body) {
      return reply.code(400).send({ error: 'from and body are required' });
    }
    const inferredCustomer =
      req.body.customerId
        ? state.customers.getById(req.body.customerId)
        : req.body.phone
          ? state.customers.findByPhone(req.body.phone)
          : undefined;
    const event: DomainEvent = {
      id: makeId('evt'),
      type: req.body.channel === 'email' ? 'inbound.email.received' : 'inbound.whatsapp.received',
      occurredAt: new Date().toISOString(),
      customerId: inferredCustomer?.id,
      payload: {
        from: req.body.from,
        subject: req.body.subject ?? null,
        body: req.body.body,
        phone: req.body.phone ?? null,
        email: req.body.email ?? null,
      },
    };
    if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
      void state.queueGateway.enqueueOrchestrator(event);
    }
    state.audit.write(
      makeAuditRecord('inbound-gateway', 'inbound.received', {
        eventType: event.type,
        customerId: event.customerId ?? null,
        from: req.body.from,
      })
    );
    const output = state.orchestrator.run({
      event,
      customer: inferredCustomer,
      activeObjectives: state.objectives.listActive(),
      activeOffers: state.offers.listActive(),
      now: new Date().toISOString(),
    });
    persistOperationalOutput(state, output);
    return reply.code(201).send({ event, customer: inferredCustomer ?? null, orchestrator: output });
  });

  app.post<{
    Body: {
      customerId?: string;
      phone?: string;
      disposition: 'answered' | 'missed' | 'callback-request' | 'complaint';
      notes: string;
    };
  }>('/api/inbound/calls/log', async (req, reply) => {
    if (ensurePermission(req, reply, 'inbound:read') === null) return;
    if (!req.body.notes || !req.body.disposition) return reply.code(400).send({ error: 'disposition and notes are required' });
    const inferredCustomer =
      req.body.customerId
        ? state.customers.getById(req.body.customerId)
        : req.body.phone
          ? state.customers.findByPhone(req.body.phone)
          : undefined;
    const event: DomainEvent = {
      id: makeId('evt'),
      type: 'inbound.whatsapp.received',
      occurredAt: new Date().toISOString(),
      customerId: inferredCustomer?.id,
      payload: {
        channel: 'call',
        disposition: req.body.disposition,
        notes: req.body.notes,
        phone: req.body.phone ?? null,
      },
    };
    if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
      void state.queueGateway.enqueueOrchestrator(event);
    }
    state.audit.write(makeAuditRecord('inbound-gateway', 'call.logged', { customerId: inferredCustomer?.id ?? null, disposition: req.body.disposition }));
    const output = state.orchestrator.run({
      event,
      customer: inferredCustomer,
      activeObjectives: state.objectives.listActive(),
      activeOffers: state.offers.listActive(),
      now: new Date().toISOString(),
    });
    persistOperationalOutput(state, output);
    return reply.code(201).send({ event, customer: inferredCustomer ?? null, orchestrator: output });
  });

  app.post<{ Body: { event: DomainEvent } }>('/api/orchestrate', async (req) => {
    const event = req.body.event;
    if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
      void state.queueGateway.enqueueOrchestrator(event);
    }
    const customer = event.customerId ? state.customers.getById(event.customerId) : undefined;
    const output = state.orchestrator.run({
      event,
      customer,
      activeObjectives: state.objectives.listActive(),
      activeOffers: state.offers.listActive(),
      now: new Date().toISOString(),
    });
    persistOperationalOutput(state, output);
    return output;
  });

  app.get('/api/manager/objectives', async () => state.objectives.listAll());
  app.post<{ Body: ManagerObjective }>('/api/manager/objectives', async (req, reply) => {
    if (ensurePermission(req, reply, 'objectives:write') === null) return;
    state.objectives.upsert(req.body);
    state.audit.write(makeAuditRecord('manager', 'objective.upserted', { objectiveId: req.body.id, name: req.body.name }));
    void state.postgresMirror.saveObjective(req.body);
    return reply.code(201).send(req.body);
  });
  app.patch<{ Params: { objectiveId: string }; Body: Partial<ManagerObjective> }>('/api/manager/objectives/:objectiveId', async (req, reply) => {
    if (ensurePermission(req, reply, 'objectives:write') === null) return;
    const current = state.objectives.getById(req.params.objectiveId);
    if (!current) return reply.code(404).send({ error: 'Objective not found' });
    const merged = { ...current, ...req.body };
    state.objectives.upsert(merged);
    state.audit.write(makeAuditRecord('manager', 'objective.updated', { objectiveId: merged.id, patch: req.body }));
    void state.postgresMirror.saveObjective(merged);
    return merged;
  });
  app.post<{ Params: { objectiveId: string }; Body: { active: boolean } }>('/api/manager/objectives/:objectiveId/activate', async (req, reply) => {
    if (ensurePermission(req, reply, 'objectives:write') === null) return;
    const current = state.objectives.getById(req.params.objectiveId);
    if (!current) return reply.code(404).send({ error: 'Objective not found' });
    const merged = { ...current, active: Boolean(req.body.active) };
    state.objectives.upsert(merged);
    state.audit.write(makeAuditRecord('manager', 'objective.activation.updated', { objectiveId: merged.id, active: merged.active }));
    void state.postgresMirror.saveObjective(merged);
    return merged;
  });
  app.delete<{ Params: { objectiveId: string } }>('/api/manager/objectives/:objectiveId', async (req, reply) => {
    if (ensurePermission(req, reply, 'objectives:write') === null) return;
    const current = state.objectives.getById(req.params.objectiveId);
    if (!current) return reply.code(404).send({ error: 'Objective not found' });
    state.objectives.upsert({ ...current, active: false });
    state.audit.write(makeAuditRecord('manager', 'objective.deleted.soft', { objectiveId: current.id }));
    return { ok: true, objectiveId: current.id, mode: 'soft-delete(active=false)' };
  });
  app.get('/api/manager/objectives/scorecard', async () => {
    const objectives = state.objectives.listAll();
    const offers = state.offers.listActive();
    return objectives.map((o) => ({
      id: o.id,
      name: o.name,
      active: o.active,
      preferredOfferIds: o.preferredOfferIds,
      preferredOffersAvailable: o.preferredOfferIds.filter((id) => offers.some((off) => off.id === id)).length,
    }));
  });
  app.get('/api/manager/kpi', async (req, reply) => {
    if (ensurePermission(req, reply, 'kpi:read') === null) return;
    const tasks = state.tasks.list();
    const outbox = state.drafts.list();
    const byChannel = outbox.reduce<Record<string, number>>((acc, item) => {
      acc[item.draft.channel] = (acc[item.draft.channel] ?? 0) + 1;
      return acc;
    }, {});
    const pendingApprovals = outbox.filter((o) => o.status === 'pending-approval').length;
    return {
      objectivesActive: state.objectives.listActive().length,
      offersActive: state.offers.listActive().length,
      ticketsOpen: state.assistance.list().filter((t) => t.outcome === 'pending').length,
      tasks: {
        total: tasks.length,
        open: tasks.filter((t) => t.status === 'open').length,
        done: tasks.filter((t) => t.status === 'done').length,
        byKind: tasks.reduce<Record<string, number>>((acc, t) => ((acc[t.kind] = (acc[t.kind] ?? 0) + 1), acc), {}),
      },
      outbox: {
        total: outbox.length,
        pendingApprovals,
        byStatus: outbox.reduce<Record<string, number>>((acc, o) => ((acc[o.status] = (acc[o.status] ?? 0) + 1), acc), {}),
        byChannel,
      },
      auditRecords: state.audit.list().length,
    };
  });

  app.post('/api/ingest/danea/sync', async () => {
    const invoices = state.danea.listRecentInvoices();
    const results = [];
    for (const invoice of invoices) {
      for (const line of invoice.lines) {
        const title = line.description;
        const offerId = makeId('offer');
        const category: ProductOffer['category'] = /oppo|iphone|samsung|smartphone/i.test(title)
          ? 'smartphone'
          : /fibra|router|mesh/i.test(title)
            ? 'connectivity'
            : 'hardware';
        const offer: ProductOffer = {
          id: offerId,
          sourceType: 'invoice',
          category,
          title,
          cost: line.unitCost,
          suggestedPrice: Math.round(line.unitCost * 1.18),
          marginPct: 18,
          stockQty: line.qty,
          targetSegments: category === 'hardware' ? ['gamer'] : category === 'smartphone' ? ['smartphone-upgrade', 'famiglia'] : ['fibra', 'gamer'],
          active: true,
        };
        state.offers.upsert(offer);
        void state.postgresMirror.saveOffer(offer);
        state.rag.add({ id: `offer:${offer.id}`, text: `${offer.title}. costo ${offer.cost}. prezzo suggerito ${offer.suggestedPrice}.` });
        const event: DomainEvent = {
          id: makeId('evt'),
          type: 'danea.invoice.ingested',
          occurredAt: invoice.receivedAt,
          payload: { invoiceId: invoice.id, lines: invoice.lines },
        };
        if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
          void state.queueGateway.enqueueOrchestrator(event);
        }
        const output = state.orchestrator.run({ event, activeObjectives: state.objectives.listActive(), activeOffers: state.offers.listActive(), now: new Date().toISOString() });
        persistOperationalOutput(state, output);
        state.audit.write(makeAuditRecord('ingest-danea', 'invoice.synced', { invoiceId: invoice.id, offerId, line: title }));
        results.push({ invoiceId: invoice.id, offer });
      }
    }
    return { synced: results.length, results };
  });
  app.get<{ Querystring: { kind?: 'danea' | 'promo' } }>('/api/ingest/history', async (req) => {
    const type = req.query.kind === 'promo'
      ? 'promo.ingested'
      : req.query.kind === 'danea'
        ? 'invoice.synced'
        : undefined;
    const records = state.audit.list().filter((r) => {
      if (r.actor !== 'ingest-danea' && r.actor !== 'ingest-promo') return false;
      return type ? r.type.endsWith(type) : true;
    });
    return records.slice(-200).reverse();
  });

  app.post<{ Body: { title: string; category?: ProductOffer['category']; conditions?: string; stockQty?: number; cost?: number; targetSegments?: Segment[] } }>(
    '/api/ingest/promo',
    async (req, reply) => {
      const offer: ProductOffer = {
        id: makeId('offer'),
        sourceType: 'promo',
        category: req.body.category ?? 'smartphone',
        title: req.body.title,
        conditions: req.body.conditions,
        cost: req.body.cost,
        suggestedPrice: req.body.cost ? Math.round(req.body.cost * 1.15) : undefined,
        marginPct: req.body.cost ? 15 : undefined,
        stockQty: req.body.stockQty ?? 10,
        targetSegments: req.body.targetSegments ?? ['smartphone-upgrade'],
        active: true,
      };
      state.offers.upsert(offer);
      void state.postgresMirror.saveOffer(offer);
      state.rag.add({ id: `offer:${offer.id}`, text: `${offer.title}. ${offer.conditions ?? ''}` });
      const event: DomainEvent = {
        id: makeId('evt'),
        type: 'offer.promo.ingested',
        occurredAt: new Date().toISOString(),
        payload: { offerId: offer.id, title: offer.title, conditions: offer.conditions },
      };
      if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
        void state.queueGateway.enqueueOrchestrator(event);
      }
      const output = state.orchestrator.run({ event, activeObjectives: state.objectives.listActive(), activeOffers: state.offers.listActive(), now: new Date().toISOString() });
      persistOperationalOutput(state, output);
      state.audit.write(makeAuditRecord('ingest-promo', 'promo.ingested', { offerId: offer.id, title: offer.title }));
      return reply.code(201).send({ offer, orchestrator: output });
    }
  );

  app.post<{ Body: { offerId?: string; offerTitle?: string; segment?: Segment; includeOneToOne?: boolean; includeOneToMany?: boolean } }>('/api/campaigns/preview', async (req, reply) => {
    const offer = resolveOfferFromRequest(state, req.body);
    if (!offer) return reply.code(404).send({ error: 'Offer not found', hint: 'Passa offerId reale da /api/offers oppure offerTitle' });
    const segment = req.body.segment ?? offer.targetSegments[0];
    if (!segment) return reply.code(400).send({ error: 'No target segment available for offer' });
    const targets = targetCustomersForOffer({
      customers: state.customers.list(),
      offer,
      objectives: state.objectives.listActive(),
      max: 25,
    });
    const llm = state.llm ?? undefined;
    const oneToOne = req.body.includeOneToOne === false ? [] : await buildOneToOneDraftsForOffer({ targets, offer, llm });
    const oneToMany = req.body.includeOneToMany === false ? [] : await buildOneToManyDraftsForOffer({ offer, segment, llm });
    return {
      offer,
      segment,
      targeting: targets.map((t) => ({ customerId: t.customer.id, fullName: t.customer.fullName, score: t.score, reasons: t.reasons })),
      drafts: { oneToOne, oneToMany },
    };
  });

  app.post<{ Body: { offerId?: string; offerTitle?: string; segment?: Segment; name?: string } }>('/api/campaigns/launch', async (req, reply) => {
    if (ensurePermission(req, reply, 'campaigns:manage') === null) return;
    const offer = resolveOfferFromRequest(state, req.body);
    if (!offer) return reply.code(404).send({ error: 'Offer not found', hint: 'Passa offerId reale da /api/offers oppure offerTitle' });
    const segment = req.body.segment ?? offer.targetSegments[0];
    if (!segment) return reply.code(400).send({ error: 'No target segment available for offer' });

    const targets = targetCustomersForOffer({ customers: state.customers.list(), offer, objectives: state.objectives.listActive(), max: 25 });
    const llm = state.llm ?? undefined;
    const drafts = [
      ...await buildOneToOneDraftsForOffer({ targets, offer, llm }),
      ...await buildOneToManyDraftsForOffer({ offer, segment, llm }),
    ];
    const tasks = buildCampaignTasks(offer, segment);
    state.tasks.addMany(tasks);
    const outboxItems = state.drafts.addMany(drafts);
    drafts.forEach((d) => state.draftsRaw.add(d));
    const campaign = {
      id: makeId('camp'),
      name: req.body.name ?? `Campagna ${offer.title} (${segment})`,
      offerId: offer.id,
      segment,
      status: 'draft' as const,
      outboxIds: outboxItems.map((o) => o.id),
      taskIds: tasks.map((t) => t.id),
      createdAt: new Date().toISOString(),
    };
    state.campaigns.add(campaign);
    state.audit.write(makeAuditRecord('campaigns', 'campaign.created', { campaignId: campaign.id, offerId: offer.id, segment, outboxCount: outboxItems.length }));
    void state.postgresMirror.saveTasks(tasks);
    void state.postgresMirror.saveOutbox(outboxItems);
    void state.postgresMirror.saveCampaign(campaign);
    if (envFlag('BISPCRM_QUEUE_CONTENT_TASKS', false)) {
      tasks
        .filter((t) => t.kind === 'content')
        .forEach((t) => void state.queueGateway.enqueueContent({ taskId: t.id, title: t.title, offerId: t.offerId ?? offer.id }));
    }
    return reply.code(201).send({ campaign, outboxItems, tasks, targetingCount: targets.length });
  });
  app.post<{ Body: { q?: string; segment?: Segment } }>('/api/campaigns/launch-latest', async (req, reply) => {
    if (ensurePermission(req, reply, 'campaigns:manage') === null) return;
    let offers = state.offers.listActive();
    if (req.body.q) {
      const q = req.body.q.toLowerCase();
      offers = offers.filter((o) => o.title.toLowerCase().includes(q));
    }
    const offer = offers[offers.length - 1];
    if (!offer) return reply.code(404).send({ error: 'No offers available' });
    const segment = req.body.segment ?? offer.targetSegments[0];
    if (!segment) return reply.code(400).send({ error: 'No target segment available for offer' });
    const targets = targetCustomersForOffer({ customers: state.customers.list(), offer, objectives: state.objectives.listActive(), max: 25 });
    const llmLatest = state.llm ?? undefined;
    const drafts = [...await buildOneToOneDraftsForOffer({ targets, offer, llm: llmLatest }), ...await buildOneToManyDraftsForOffer({ offer, segment, llm: llmLatest })];
    const tasks = buildCampaignTasks(offer, segment);
    state.tasks.addMany(tasks);
    const outboxItems = state.drafts.addMany(drafts);
    drafts.forEach((d) => state.draftsRaw.add(d));
    const campaign = {
      id: makeId('camp'),
      name: `Campagna ${offer.title} (${segment})`,
      offerId: offer.id,
      segment,
      status: 'draft' as const,
      outboxIds: outboxItems.map((o) => o.id),
      taskIds: tasks.map((t) => t.id),
      createdAt: new Date().toISOString(),
    };
    state.campaigns.add(campaign);
    state.audit.write(makeAuditRecord('campaigns', 'campaign.created', { campaignId: campaign.id, offerId: offer.id, segment, outboxCount: outboxItems.length }));
    void state.postgresMirror.saveTasks(tasks);
    void state.postgresMirror.saveOutbox(outboxItems);
    void state.postgresMirror.saveCampaign(campaign);
    if (envFlag('BISPCRM_QUEUE_CONTENT_TASKS', false)) {
      tasks
        .filter((t) => t.kind === 'content')
        .forEach((t) => void state.queueGateway.enqueueContent({ taskId: t.id, title: t.title, offerId: t.offerId ?? offer.id }));
    }
    return reply.code(201).send({ campaign, outboxItems, tasks, targetingCount: targets.length });
  });

  app.post<{ Body: { customerId: string; prompt?: string; offerId?: string } }>('/api/consult/proposal', async (req, reply) => {
    if (ensurePermission(req, reply, 'consult:read') === null) return;
    const customer = state.customers.getById(req.body.customerId);
    if (!customer) return reply.code(404).send({ error: 'Customer not found' });
    const personaHints = Object.fromEntries(
      state.characterStudio
        .list()
        .filter((c) => c.enabled)
        .map((c) => [c.key, state.characterStudio.toElizaLike(c.key)])
        .filter(([, v]) => Boolean(v))
    ) as Record<string, unknown>;
    const result = await consultProposal({
      customer,
      objectives: state.objectives.listActive(),
      offers: state.offers.listActive(),
      prompt: req.body.prompt,
      offerId: req.body.offerId,
      rag: state.rag,
      personaHintsOverride: personaHints,
      llm: state.llm ?? undefined,
    });
    state.audit.write(makeAuditRecord('consult-agent', 'consult.proposal.generated', { customerId: customer.id, offerId: req.body.offerId ?? null }));
    return result;
  });

  app.get('/api/scenarios', async () => ({
    repairNotWorth: 'ticket assistenza -> non conviene riparare -> preventivo notebook',
    gamerLag: 'ticket assistenza gamer -> proposta connectivity gaming',
    hardwareInvoice: 'fattura hardware -> task content',
    smartphonePromo: 'promo smartphone bundle -> campagna telefonia',
    complaintEmail: 'email reclamo post-vendita -> customer care + proposta coerente'
  }));

  app.post<{ Params: { name: string } }>('/api/scenarios/:name/run', async (req, reply) => {
    const event = (scenarioFactory as Record<string, () => DomainEvent>)[req.params.name]?.();
    if (!event) return reply.code(404).send({ error: 'Scenario not found' });
    if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
      void state.queueGateway.enqueueOrchestrator(event);
    }
    const customer = event.customerId ? state.customers.getById(event.customerId) : undefined;
    const output = state.orchestrator.run({ event, customer, activeObjectives: state.objectives.listActive(), activeOffers: state.offers.listActive(), now: new Date().toISOString() });
    persistOperationalOutput(state, output);
    return { scenario: req.params.name, event, output };
  });

  app.post<{ Params: { ticketId: string }; Body: { diagnosis?: string; outcome: AssistanceTicket['outcome']; inferredSignals?: string[] } }>(
    '/api/assist/tickets/:ticketId/outcome',
    async (req, reply) => {
      const ticket = state.assistance.getById(req.params.ticketId);
      if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });

      ticket.diagnosis = req.body.diagnosis ?? ticket.diagnosis;
      ticket.outcome = req.body.outcome;
      ticket.inferredSignals = req.body.inferredSignals ?? ticket.inferredSignals;
      ticket.updatedAt = new Date().toISOString();
      state.assistance.upsert(ticket);
      void state.postgresMirror.saveTicket(ticket);

      state.audit.write(
        makeAuditRecord('assist-desk', 'assist.ticket.outcome.updated', {
          ticketId: ticket.id,
          outcome: ticket.outcome,
          inferredSignals: ticket.inferredSignals,
          customerId: ticket.customerId ?? null,
        })
      );

      const event: DomainEvent = {
        id: makeId('evt'),
        type: 'assistance.ticket.outcome',
        occurredAt: new Date().toISOString(),
        customerId: ticket.customerId,
        payload: {
          ticketId: ticket.id,
          outcome: ticket.outcome,
          deviceType: ticket.deviceType,
          inferredSignals: ticket.inferredSignals,
          diagnosis: ticket.diagnosis,
        },
      };
      if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
        void state.queueGateway.enqueueOrchestrator(event);
      }

      const customer = event.customerId ? state.customers.getById(event.customerId) : undefined;
      const output = state.orchestrator.run({
        event,
        customer,
        activeObjectives: state.objectives.listActive(),
        activeOffers: state.offers.listActive(),
        now: new Date().toISOString(),
      });
      persistOperationalOutput(state, output);

      return { ticket, orchestrator: output };
    }
  );

  // ── WordPress publish ─────────────────────────────────────────────────────
  app.post(
    '/api/content/publish/wordpress',
    async (req, reply) => {
      const body = req.body as {
        title?: string;
        content?: string;
        excerpt?: string;
        status?: 'publish' | 'draft' | 'pending';
        categories?: number[];
        tags?: number[];
        slug?: string;
      };

      if (!body?.title || !body?.content) {
        return reply.code(400).send({ error: 'title e content sono obbligatori' });
      }

      const wp = createWordPressClientFromEnv();
      if (!wp) {
        return reply.code(503).send({
          error: 'WordPress non configurato (WORDPRESS_SITE_URL, WORDPRESS_USERNAME, WORDPRESS_APP_PASSWORD mancanti)',
        });
      }

      try {
        const result = await wp.createPost({
          title: body.title,
          content: body.content,
          excerpt: body.excerpt,
          status: body.status ?? 'draft',
          categories: body.categories,
          tags: body.tags,
          slug: body.slug,
        });
        state.audit.write(makeAuditRecord('content', 'wordpress.post.created', { postId: result.id, link: result.link, status: result.status }));
        return { ok: true, post: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state.audit.write(makeAuditRecord('content', 'wordpress.post.failed', { error: message }));
        return reply.code(502).send({ error: message });
      }
    }
  );

  // ─── CopilotRM Chat endpoint ─────────────────────────────────────────────

  app.post<{
    Body: {
      message: string;
      customerId?: string;
      sessionId?: string;
    };
  }>('/api/chat', async (req, reply) => {
    if (ensurePermission(req, reply, 'consult:read') === null) return;
    const { message, customerId } = req.body;
    if (!message?.trim()) {
      return reply.code(400).send({ error: 'message è obbligatorio' });
    }

    const customer = customerId ? state.customers.getById(customerId) : undefined;

    // Stub response when LLM is not configured
    if (!state.llm) {
      const stub = customer
        ? `Ciao! Sono CopilotRM. Stai lavorando con il cliente ${customer.fullName} (segmenti: ${customer.segments?.join(', ')}). LLM non configurato — imposta LLM_PROVIDER nel file .env per risposte AI reali. Messaggio ricevuto: "${message}".`
        : `Ciao! Sono CopilotRM. LLM non configurato — imposta LLM_PROVIDER nel file .env. Messaggio ricevuto: "${message}".`;
      return { reply: stub, provider: 'stub', sessionId: req.body.sessionId };
    }

    const characters = state.characterStudio.list();
    const mainChar = characters.find((c) => c.enabled) ?? characters[0];

    const systemLines: string[] = [
      'Sei CopilotRM, un assistente AI per la gestione clienti di un negozio di elettronica e telecomunicazioni.',
    ];
    if (mainChar) {
      systemLines.push(`Il tuo ruolo: ${mainChar.role}.`);
      if (mainChar.tone?.length) systemLines.push(`Tono: ${mainChar.tone.join(', ')}.`);
      if (mainChar.goals?.length) systemLines.push(`Obiettivi: ${mainChar.goals.join('; ')}.`);
      if (mainChar.limits?.length) systemLines.push(`Limiti: ${mainChar.limits.join('; ')}.`);
    }
    systemLines.push('Rispondi sempre in italiano, in modo conciso e orientato all\'azione.');

    if (customer) {
      systemLines.push(`Stai assistendo con il cliente: ${customer.fullName}.`);
      if (customer.segments?.length) systemLines.push(`Segmenti cliente: ${customer.segments.join(', ')}.`);
      if (customer.interests?.length) systemLines.push(`Interessi: ${customer.interests.join(', ')}.`);
    }

    try {
      const res = await state.llm.chat(
        [
          { role: 'system', content: systemLines.join(' ') },
          { role: 'user', content: message },
        ],
        { maxTokens: 512, temperature: 0.7 }
      );
      state.audit.write(makeAuditRecord('chat', 'chat.response', { customerId: customerId ?? null, provider: res.provider }));
      return { reply: res.content, provider: res.provider, model: res.model, sessionId: req.body.sessionId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { reply: `Errore LLM: ${msg}`, provider: 'error', sessionId: req.body.sessionId };
    }
  });

  // ─── NLP Intake: testo libero → dati strutturati ────────────────────────────

  app.post<{ Body: { text: string } }>('/api/assist/intake-nlp', async (req, reply) => {
    if (ensurePermission(req, reply, 'inbound:read') === null) return;
    const { text } = req.body;
    if (!text?.trim()) return reply.code(400).send({ error: 'text è obbligatorio' });

    // ── Fallback parser (regex) quando LLM non è configurato ──
    function fallbackParse(raw: string): Record<string, unknown> {
      const phoneMatch = raw.match(/(?:\+?39\s?)?(?:0\d{6,10}|3\d{9})/);
      const phone = phoneMatch?.[0]?.replace(/\s/g, '') ?? '';
      const catMap: Array<[string, RegExp]> = [
        ['PC PORTATILE', /portati|laptop|notebook/i],
        ['PC FISSO', /fisso|desktop|tower/i],
        ['SMARTPHONE', /smartphone|iphone|samsung.*galaxy|android/i],
        ['TABLET', /tablet|ipad/i],
        ['CELLULARE', /cellulare|telefonino/i],
        ['STAMPANTE', /stampa|printer|epson|canon|hp/i],
        ['TELEVISORE', /tv|televisor|monitor/i],
        ['CONSOLE', /playstation|ps[45]|xbox|nintendo/i],
      ];
      let deviceCategory = 'VARIE';
      for (const [cat, re] of catMap) { if (re.test(raw)) { deviceCategory = cat; break; } }
      const brandRe = /\b(apple|samsung|lg|asus|acer|dell|hp|lenovo|huawei|xiaomi|oppo|realme|honor|corsair|logitech|microsoft|sony)\b/i;
      const brand = raw.match(brandRe)?.[1] ?? undefined;
      // Rough name extraction: first-looking capitalized words before device mention
      const nameMatch = raw.match(/^([A-ZÀÁÈÉÌÍÒÓÙÚ][a-zàáèéìíòóùú]+(?:\s+[A-ZÀÁÈÉÌÍÒÓÙÚ][a-zàáèéìíòóùú]+){0,2})/);
      const customerName = nameMatch?.[1] ?? undefined;
      return { customerName, phone, deviceCategory, brand, model: undefined, serialNumber: undefined, issueDescription: raw.trim(), hasWarranty: false, estimatedPrice: null, signals: [] };
    }

    if (!state.llm) {
      const parsed = fallbackParse(text);
      return { parsed, provider: 'fallback', rawText: text };
    }

    const systemPrompt = `Sei un assistente per l'accettazione di assistenza tecnica in un negozio di elettronica italiano.
Il tuo compito è estrarre i dati strutturati dal testo parlato/scritto dall'operatore.
Rispondi SOLO con JSON valido, senza markdown, senza spiegazioni.
I valori non trovati devono essere null o stringa vuota.
deviceCategory deve essere uno di: "PC PORTATILE","PC FISSO","SMARTPHONE","TABLET","CELLULARE","STAMPANTE","TELEVISORE","CONSOLE","VARIE".`;

    const userPrompt = `Estrai i dati da questo testo di accettazione assistenza:
"${text}"

Restituisci JSON con questi campi:
{
  "customerName": "nome e cognome del cliente",
  "phone": "numero telefono (solo cifre, no spazi)",
  "deviceCategory": "categoria dispositivo",
  "brand": "marca",
  "model": "modello esatto",
  "serialNumber": "numero seriale se presente",
  "issueDescription": "descrizione completa e dettagliata del problema dichiarato dal cliente",
  "hasWarranty": false,
  "estimatedPrice": null,
  "signals": ["array di tag: gamer|network-issue|hardware-fail|screen|battery|charging|water-damage|slow|virus|..."]
}`;

    try {
      const res = await state.llm.chat(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { maxTokens: 600, temperature: 0.2 }
      );
      let parsed: Record<string, unknown>;
      try {
        // Strip markdown code fences if LLM wraps in ```json
        const clean = res.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        parsed = JSON.parse(clean) as Record<string, unknown>;
      } catch {
        parsed = fallbackParse(text);
        parsed['llmRaw'] = res.content;
      }
      return { parsed, provider: res.provider, model: res.model, rawText: text };
    } catch (err) {
      const parsed = fallbackParse(text);
      return { parsed, provider: 'fallback', error: err instanceof Error ? err.message : String(err), rawText: text };
    }
  });

  // ─── Scheda assistenza HTML (stampabile) ──────────────────────────────────

  app.get<{ Params: { id: string } }>('/api/assist/tickets/:id/scheda', async (req, reply) => {
    if (ensurePermission(req, reply, 'inbound:read') === null) return;
    const ticket = state.assistance.list().find((t) => t.id === req.params.id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket non trovato' });

    const customer = ticket.customerId ? state.customers.getById(ticket.customerId) : undefined;
    const env = process.env;

    const co = {
      name: env.COMPANY_NAME ?? '',
      address: `${env.COMPANY_ADDRESS ?? ''}, ${env.COMPANY_CITY ?? ''}`,
      phone: env.COMPANY_PHONE ?? '',
      phone2: env.COMPANY_PHONE2 ?? '',
      email: env.COMPANY_EMAIL ?? '',
      pec: env.COMPANY_PEC ?? '',
      website: env.COMPANY_WEBSITE ?? '',
      vat: env.COMPANY_VAT ?? '',
      cf: env.COMPANY_CF ?? '',
    };

    const dateStr = new Date(ticket.createdAt).toLocaleDateString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const ticketNum = ticket.id.replace('ticket_', '').toUpperCase();
    const customerName = ticket.customerName ?? customer?.fullName ?? '—';
    const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Scheda Assistenza ${ticketNum}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:12mm}
  @media print{body{padding:0}@page{size:A4;margin:12mm}}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #c00;padding-bottom:8px;margin-bottom:10px}
  .co-name{font-size:18px;font-weight:700;color:#c00}
  .co-details{font-size:10px;line-height:1.6;color:#333}
  .ticket-ref{text-align:right}
  .ticket-ref .num{font-size:22px;font-weight:700;color:#1a3d6b}
  .ticket-ref .lbl{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.05em}
  .section{border:1px solid #bbb;border-radius:4px;margin-bottom:8px;overflow:hidden}
  .section-title{background:#1a3d6b;color:#fff;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:4px 8px}
  .fields{display:grid;gap:0}
  .row{display:flex;border-top:1px solid #ddd}
  .row:first-child{border-top:none}
  .field{flex:1;padding:5px 8px;border-right:1px solid #ddd}
  .field:last-child{border-right:none}
  .field-2{flex:2}
  .field-3{flex:3}
  .lbl{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:2px}
  .val{font-size:11px;font-weight:600;min-height:14px}
  .bigtext{padding:8px;min-height:50px;font-size:11px;line-height:1.6;white-space:pre-wrap}
  .footer{display:flex;justify-content:space-between;margin-top:12px;gap:20px}
  .sig-box{flex:1;border-top:1px solid #bbb;padding-top:6px;font-size:10px;color:#555}
  .barcode-placeholder{font-family:monospace;font-size:9px;letter-spacing:.1em;color:#888;border:1px dashed #ccc;padding:4px 8px;display:inline-block;border-radius:3px}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:80px;color:rgba(200,0,0,.04);font-weight:900;pointer-events:none;z-index:-1}
  .warn{color:#c00;font-size:9px}
  .status-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
  .status-pending{background:#fef3c7;color:#92400e}
  .status-repair{background:#d1fae5;color:#065f46}
  .status-not-worth{background:#fee2e2;color:#991b1b}
  .no-print{margin-top:14px;text-align:center}
  @media print{.no-print{display:none}}
  button.print-btn{background:#1a3d6b;color:#fff;border:none;padding:10px 24px;font-size:14px;border-radius:6px;cursor:pointer;font-weight:600}
  button.print-btn:hover{background:#153168}
</style>
</head>
<body>
<div class="watermark">ASSISTENZA</div>

<!-- Header -->
<div class="header">
  <div>
    <div class="co-name">${co.name}</div>
    <div class="co-details">
      ${co.address}<br>
      Tel: ${co.phone}${co.phone2 ? ' / ' + co.phone2 : ''}<br>
      ${co.email}${co.pec ? ' | PEC: ' + co.pec : ''}<br>
      ${co.website ? co.website + ' | ' : ''}C.F./P.Iva: ${co.vat}
    </div>
  </div>
  <div class="ticket-ref">
    <div class="lbl">Scheda di Assistenza</div>
    <div class="num">${ticketNum}</div>
    <div class="lbl">Data ritiro: ${dateStr}</div>
    <div style="margin-top:4px">
      <span class="status-pill status-${ticket.outcome === 'repair' ? 'repair' : ticket.outcome === 'not-worth-repairing' ? 'not-worth' : 'pending'}">
        ${ticket.outcome === 'repair' ? 'In Riparazione' : ticket.outcome === 'not-worth-repairing' ? 'Non Conveniente' : 'Accettato'}
      </span>
    </div>
    <div style="margin-top:6px"><span class="barcode-placeholder">*${ticketNum}*</span></div>
  </div>
</div>

<!-- Cliente -->
<div class="section">
  <div class="section-title">Cliente</div>
  <div class="fields">
    <div class="row">
      <div class="field field-3"><span class="lbl">Cognome e Nome</span><div class="val">${customerName}</div></div>
      <div class="field"><span class="lbl">Telefono / GSM</span><div class="val">${ticket.phoneLookup}</div></div>
      <div class="field field-2"><span class="lbl">eMail</span><div class="val">${ticket.customerEmail ?? customer?.email ?? '—'}</div></div>
    </div>
    <div class="row">
      <div class="field field-3"><span class="lbl">Indirizzo</span><div class="val">—</div></div>
      <div class="field"><span class="lbl">Cod. Cliente</span><div class="val">${customer?.id ?? ticket.customerId ?? 'PROVVISORIO'}</div></div>
      <div class="field field-2">${ticket.provisionalCustomer ? '<span class="warn">⚠ Cliente provvisorio — non presente in anagrafica</span>' : ''}</div>
    </div>
  </div>
</div>

<!-- Prodotto -->
<div class="section">
  <div class="section-title">Prodotto / Apparecchiatura</div>
  <div class="fields">
    <div class="row">
      <div class="field field-2"><span class="lbl">Categoria</span><div class="val">${ticket.deviceType}</div></div>
      <div class="field field-2"><span class="lbl">Marca</span><div class="val">${ticket.brand ?? '—'}</div></div>
      <div class="field field-3"><span class="lbl">Modello</span><div class="val">${ticket.model ?? '—'}</div></div>
    </div>
    <div class="row">
      <div class="field field-2"><span class="lbl">Nr. Serie</span><div class="val">${ticket.serialNumber ?? '—'}</div></div>
      <div class="field"><span class="lbl">Garanzia</span><div class="val">${ticket.hasWarranty ? 'Sì' : 'No'}</div></div>
      <div class="field"><span class="lbl">Preventivo € </span><div class="val">${ticket.estimatedPrice != null ? ticket.estimatedPrice.toFixed(2) : '—'}</div></div>
      <div class="field field-2"><span class="lbl">Segnali / Tag</span><div class="val" style="font-size:10px">${ticket.inferredSignals.join(', ') || '—'}</div></div>
    </div>
  </div>
</div>

<!-- Difetto dichiarato -->
<div class="section">
  <div class="section-title">Tipo di Guasto / Difetto Dichiarato</div>
  <div class="bigtext">${ticket.issue}</div>
</div>

<!-- Note -->
${ticket.ticketNotes ? `<div class="section">
  <div class="section-title">Note Operative</div>
  <div class="bigtext">${ticket.ticketNotes}</div>
</div>` : ''}

<!-- Esito -->
<div class="section">
  <div class="section-title">Esito Assistenza</div>
  <div class="fields">
    <div class="row">
      <div class="field"><span class="lbl">Esito</span><div class="val">${ticket.diagnosis ?? '—'}</div></div>
      <div class="field"><span class="lbl">Data Rientro</span><div class="val">&nbsp;</div></div>
      <div class="field"><span class="lbl">Importo Pagato €</span><div class="val">&nbsp;</div></div>
      <div class="field"><span class="lbl">Data Riconsegna</span><div class="val">&nbsp;</div></div>
    </div>
    <div class="row">
      <div class="field field-3"><span class="lbl">Note Esito / Riconsegna</span><div class="val" style="min-height:30px">&nbsp;</div></div>
      <div class="field"><span class="lbl">Richiamato</span><div class="val">&nbsp;</div></div>
    </div>
  </div>
</div>

<!-- Footer firme -->
<div class="footer">
  <div class="sig-box">
    <strong>Firma Cliente</strong><br><br><br>
    <span style="font-size:9px;color:#aaa">Il cliente dichiara di aver letto e accettato le condizioni di servizio</span>
  </div>
  <div class="sig-box">
    <strong>Operatore</strong><br><br><br>
    <span style="font-size:9px;color:#aaa">Timbro / Firma</span>
  </div>
  <div class="sig-box">
    <strong>Nota ritiro / privacy</strong><br>
    <span style="font-size:9px;line-height:1.5">I dati personali sono trattati ai sensi del GDPR 679/2016. La presente scheda costituisce ricevuta di accettazione del bene in assistenza.</span>
  </div>
</div>

<div class="no-print" style="margin-top:20px">
  <button class="print-btn" onclick="window.print()">🖨️ Stampa / Salva PDF</button>
  <button style="margin-left:12px;background:none;border:1px solid #ccc;padding:10px 18px;border-radius:6px;cursor:pointer" onclick="window.close()">Chiudi</button>
</div>
</body>
</html>`;

    void reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.send(html);
  });

  return app;
}

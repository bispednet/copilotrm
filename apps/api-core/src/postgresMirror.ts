import { logger } from '@bisp/shared-logger';
import { PgRuntime } from '@bisp/shared-db';
import type { AssistanceTicket, AuditRecord, CustomerProfile, ManagerObjective, ProductOffer, TaskItem } from '@bisp/shared-types';
import type { AdminSettingItem } from './admin/settings';
import type { CampaignRecord, OutboxItem } from './localRepos';

export type PersistenceMode = 'memory' | 'postgres';

export interface PostgresMirrorOptions {
  enabled: boolean;
  connectionString: string;
}

export interface ChannelDispatchRecord {
  id: string;
  source: 'api-core' | 'gateway-channels';
  draftId?: string;
  channel: string;
  status: 'queued' | 'sent' | 'failed';
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  error?: string;
  createdAt: string;
  sentAt?: string;
}

export interface MediaJobRecord {
  id: string;
  kind: 'text' | 'voice-script' | 'avatar-video' | 'podcast';
  title: string;
  brief: string;
  channel?: 'blog' | 'facebook' | 'instagram' | 'x' | 'telegram' | 'whatsapp';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  requestPayload: Record<string, unknown>;
  resultPayload?: Record<string, unknown>;
  error?: string;
  createdBy?: string;
  createdAt: string;
  processedAt?: string;
}

export class PostgresMirror {
  readonly enabled: boolean;
  private readonly db?: PgRuntime;
  private migrationsTried = false;
  private migrationsOk = false;

  constructor(opts: PostgresMirrorOptions) {
    this.enabled = opts.enabled;
    if (opts.enabled) {
      this.db = new PgRuntime({ connectionString: opts.connectionString });
    }
  }

  private async ensureReady(): Promise<boolean> {
    if (!this.enabled || !this.db) return false;
    if (this.migrationsTried) return this.migrationsOk;
    this.migrationsTried = true;
    try {
      await this.db.runMigrations();
      this.migrationsOk = true;
      return true;
    } catch (error) {
      logger.warn('postgres mirror disabled for runtime (migration failed)', { error: error instanceof Error ? error.message : String(error) });
      this.migrationsOk = false;
      return false;
    }
  }

  async health(): Promise<{ enabled: boolean; ready: boolean; db?: { ok: boolean; now?: string; error?: string } }> {
    if (!this.enabled || !this.db) return { enabled: false, ready: false };
    const db = await this.db.health();
    const ready = db.ok && (await this.ensureReady());
    return { enabled: true, ready, db };
  }

  async close(): Promise<void> {
    await this.db?.close();
  }

  async saveAudit(records: AuditRecord[]): Promise<void> {
    if (!(await this.ensureReady()) || !this.db || records.length === 0) return;
    for (const r of records) {
      await this.db.pool.query(
        `insert into audit_log (id, actor, type, payload, timestamp)
         values ($1,$2,$3,$4::jsonb,$5::timestamptz)
         on conflict (id) do nothing`,
        [r.id, r.actor, r.type, JSON.stringify(r.payload), r.timestamp]
      );
    }
  }

  async saveTasks(tasks: TaskItem[]): Promise<void> {
    if (!(await this.ensureReady()) || !this.db || tasks.length === 0) return;
    for (const t of tasks) {
      await this.db.pool.query(
        `insert into tasks (id, kind, status, assignee_role, title, priority, customer_id, ticket_id, offer_id, payload, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::timestamptz, now())
         on conflict (id) do update set status=excluded.status, assignee_role=excluded.assignee_role, priority=excluded.priority, payload=excluded.payload, updated_at=now()`,
        [t.id, t.kind, t.status, t.assigneeRole, t.title, t.priority, t.customerId ?? null, t.ticketId ?? null, t.offerId ?? null, JSON.stringify(t), t.createdAt]
      );
    }
  }

  async saveOutbox(items: OutboxItem[]): Promise<void> {
    if (!(await this.ensureReady()) || !this.db || items.length === 0) return;
    for (const i of items) {
      await this.db.pool.query(
        `insert into outbox_messages (id, channel, audience, status, customer_id, related_offer_id, draft, metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb, now(), now())
         on conflict (id) do update set status=excluded.status, draft=excluded.draft, metadata=excluded.metadata, updated_at=now()`,
        [
          i.id,
          i.draft.channel,
          i.draft.audience,
          i.status,
          i.draft.customerId ?? null,
          i.draft.relatedOfferId ?? null,
          JSON.stringify(i.draft),
          JSON.stringify({ approvedBy: i.approvedBy ?? null, approvedAt: i.approvedAt ?? null, rejectedBy: i.rejectedBy ?? null, rejectedAt: i.rejectedAt ?? null, sentAt: i.sentAt ?? null, externalId: i.externalId ?? null }),
        ]
      );
    }
  }

  async saveOffer(offer: ProductOffer): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into offers (id, category, source_type, title, payload, active, created_at, updated_at)
       values ($1,$2,$3,$4,$5::jsonb,$6, now(), now())
       on conflict (id) do update set category=excluded.category, source_type=excluded.source_type, title=excluded.title, payload=excluded.payload, active=excluded.active, updated_at=now()`,
      [offer.id, offer.category, offer.sourceType, offer.title, JSON.stringify(offer), offer.active]
    );
  }

  async saveObjective(objective: ManagerObjective): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into manager_objectives (id, name, active, period_start, period_end, payload, created_at, updated_at)
       values ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6::jsonb, now(), now())
       on conflict (id) do update set name=excluded.name, active=excluded.active, period_start=excluded.period_start, period_end=excluded.period_end, payload=excluded.payload, updated_at=now()`,
      [objective.id, objective.name, objective.active, objective.periodStart, objective.periodEnd, JSON.stringify(objective)]
    );
  }

  async saveTicket(ticket: AssistanceTicket): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into assistance_tickets (id, customer_id, provisional_customer, phone_lookup, device_type, issue, diagnosis, outcome, inferred_signals, payload, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::timestamptz,$12::timestamptz)
       on conflict (id) do update set customer_id=excluded.customer_id, provisional_customer=excluded.provisional_customer, phone_lookup=excluded.phone_lookup, device_type=excluded.device_type, issue=excluded.issue, diagnosis=excluded.diagnosis, outcome=excluded.outcome, inferred_signals=excluded.inferred_signals, payload=excluded.payload, updated_at=excluded.updated_at`,
      [
        ticket.id,
        ticket.customerId ?? null,
        Boolean(ticket.provisionalCustomer),
        String(ticket.phoneLookup ?? ''),
        String(ticket.deviceType ?? ''),
        String(ticket.issue ?? ''),
        ticket.diagnosis ? String(ticket.diagnosis) : null,
        ticket.outcome ? String(ticket.outcome) : null,
        JSON.stringify(ticket.inferredSignals ?? []),
        JSON.stringify(ticket),
        String(ticket.createdAt ?? new Date().toISOString()),
        String(ticket.updatedAt ?? new Date().toISOString()),
      ]
    );
  }

  async saveAdminSetting(item: AdminSettingItem): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into admin_settings (key, category, type, source, value, updated_at)
       values ($1,$2,$3,$4,$5::jsonb, now())
       on conflict (key) do update set category=excluded.category, type=excluded.type, source=excluded.source, value=excluded.value, updated_at=now()`,
      [item.key, item.category, item.type, item.source, JSON.stringify(item.value)]
    );
  }

  async saveCustomer(customer: CustomerProfile): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into customers (id, full_name, phone, email, payload, created_at, updated_at)
       values ($1,$2,$3,$4,$5::jsonb, now(), now())
       on conflict (id) do update set full_name=excluded.full_name, phone=excluded.phone, email=excluded.email, payload=excluded.payload, updated_at=now()`,
      [customer.id, customer.fullName, customer.phone ?? null, customer.email ?? null, JSON.stringify(customer)]
    );
  }

  async saveCampaign(record: CampaignRecord): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into campaigns (id, name, offer_id, segment, status, payload, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz, now())
       on conflict (id) do update set name=excluded.name, offer_id=excluded.offer_id, segment=excluded.segment, status=excluded.status, payload=excluded.payload, updated_at=now()`,
      [record.id, record.name, record.offerId ?? null, record.segment ?? null, record.status, JSON.stringify(record), record.createdAt]
    );
  }

  async saveChannelDispatch(record: ChannelDispatchRecord): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into channel_dispatches (id, source, draft_id, channel, status, request_payload, response_payload, error, created_at, sent_at, updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::timestamptz,$10::timestamptz, now())
       on conflict (id) do update set status=excluded.status, response_payload=excluded.response_payload, error=excluded.error, sent_at=excluded.sent_at, updated_at=now()`,
      [
        record.id,
        record.source,
        record.draftId ?? null,
        record.channel,
        record.status,
        JSON.stringify(record.requestPayload ?? {}),
        JSON.stringify(record.responsePayload ?? {}),
        record.error ?? null,
        record.createdAt,
        record.sentAt ?? null,
      ]
    );
  }

  async saveMediaJob(record: MediaJobRecord): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into media_jobs (id, kind, title, brief, channel, status, request_payload, result_payload, error, created_by, created_at, processed_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::timestamptz,$12::timestamptz, now())
       on conflict (id) do update set status=excluded.status, result_payload=excluded.result_payload, error=excluded.error, processed_at=excluded.processed_at, updated_at=now()`,
      [
        record.id,
        record.kind,
        record.title,
        record.brief,
        record.channel ?? null,
        record.status,
        JSON.stringify(record.requestPayload ?? {}),
        JSON.stringify(record.resultPayload ?? null),
        record.error ?? null,
        record.createdBy ?? null,
        record.createdAt,
        record.processedAt ?? null,
      ]
    );
  }

  async snapshotCounts(): Promise<Record<string, number>> {
    if (!(await this.ensureReady()) || !this.db) return {};
    const tables = [
      'customers',
      'assistance_tickets',
      'offers',
      'manager_objectives',
      'tasks',
      'outbox_messages',
      'campaigns',
      'audit_log',
      'admin_settings',
      'channel_dispatches',
      'media_jobs',
    ];
    const out: Record<string, number> = {};
    for (const table of tables) {
      const res = await this.db.pool.query<{ count: string }>(`select count(*)::text as count from ${table}`);
      out[table] = Number(res.rows[0]?.count ?? 0);
    }
    return out;
  }

  async loadCustomers(): Promise<CustomerProfile[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{ payload: unknown }>('select payload from customers');
    return res.rows.map((r) => safeJson<CustomerProfile>(r.payload)).filter(Boolean) as CustomerProfile[];
  }

  async loadTickets(): Promise<AssistanceTicket[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{ payload: unknown }>('select payload from assistance_tickets');
    return res.rows.map((r) => safeJson<AssistanceTicket>(r.payload)).filter(Boolean) as AssistanceTicket[];
  }

  async loadOffers(): Promise<ProductOffer[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{ payload: unknown }>('select payload from offers');
    return res.rows.map((r) => safeJson<ProductOffer>(r.payload)).filter(Boolean) as ProductOffer[];
  }

  async loadObjectives(): Promise<ManagerObjective[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{ payload: unknown }>('select payload from manager_objectives');
    return res.rows.map((r) => safeJson<ManagerObjective>(r.payload)).filter(Boolean) as ManagerObjective[];
  }

  async loadTasks(): Promise<TaskItem[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{ payload: unknown }>('select payload from tasks');
    return res.rows.map((r) => safeJson<TaskItem>(r.payload)).filter(Boolean) as TaskItem[];
  }

  async loadOutbox(): Promise<OutboxItem[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{ id: string; status: string; draft: unknown; metadata: unknown }>(
      'select id, status, draft, metadata from outbox_messages'
    );
    return res.rows
      .map((r) => {
        const draft = safeJson<OutboxItem['draft']>(r.draft);
        const metadata = safeJson<Record<string, unknown>>(r.metadata) ?? {};
        if (!draft) return null;
        return {
          id: r.id,
          status: r.status as OutboxItem['status'],
          draft,
          approvedBy: asOptionalString(metadata.approvedBy),
          approvedAt: asOptionalString(metadata.approvedAt),
          rejectedBy: asOptionalString(metadata.rejectedBy),
          rejectedAt: asOptionalString(metadata.rejectedAt),
          sentAt: asOptionalString(metadata.sentAt),
          externalId: asOptionalString(metadata.externalId),
        } satisfies OutboxItem;
      })
      .filter(Boolean) as OutboxItem[];
  }

  async loadCampaigns(): Promise<CampaignRecord[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{ payload: unknown }>('select payload from campaigns');
    return res.rows.map((r) => safeJson<CampaignRecord>(r.payload)).filter(Boolean) as CampaignRecord[];
  }

  async loadAdminSettings(): Promise<AdminSettingItem[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{ key: string; category: string; type: string; source: string; value: unknown }>(
      'select key, category, type, source, value from admin_settings'
    );
    return res.rows.map((r) => ({
      key: r.key,
      category: r.category as AdminSettingItem['category'],
      type: r.type as AdminSettingItem['type'],
      source: r.source as AdminSettingItem['source'],
      value: safeJson<AdminSettingItem['value']>(r.value),
    }));
  }

  async loadChannelDispatches(limit = 200): Promise<ChannelDispatchRecord[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{
      id: string;
      source: 'api-core' | 'gateway-channels';
      draft_id: string | null;
      channel: string;
      status: 'queued' | 'sent' | 'failed';
      request_payload: unknown;
      response_payload: unknown;
      error: string | null;
      created_at: string;
      sent_at: string | null;
    }>(
      `select id, source, draft_id, channel, status, request_payload, response_payload, error, created_at::text, sent_at::text
       from channel_dispatches
       order by created_at desc
       limit $1`,
      [limit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      source: r.source,
      draftId: r.draft_id ?? undefined,
      channel: r.channel,
      status: r.status,
      requestPayload: safeJson<Record<string, unknown>>(r.request_payload) ?? {},
      responsePayload: safeJson<Record<string, unknown>>(r.response_payload) ?? {},
      error: r.error ?? undefined,
      createdAt: r.created_at,
      sentAt: r.sent_at ?? undefined,
    }));
  }

  async loadMediaJobs(limit = 200): Promise<MediaJobRecord[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{
      id: string;
      kind: 'text' | 'voice-script' | 'avatar-video' | 'podcast';
      title: string;
      brief: string;
      channel: 'blog' | 'facebook' | 'instagram' | 'x' | 'telegram' | 'whatsapp' | null;
      status: 'queued' | 'processing' | 'completed' | 'failed';
      request_payload: unknown;
      result_payload: unknown;
      error: string | null;
      created_by: string | null;
      created_at: string;
      processed_at: string | null;
    }>(
      `select id, kind, title, brief, channel, status, request_payload, result_payload, error, created_by, created_at::text, processed_at::text
       from media_jobs
       order by created_at desc
       limit $1`,
      [limit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      brief: r.brief,
      channel: r.channel ?? undefined,
      status: r.status,
      requestPayload: safeJson<Record<string, unknown>>(r.request_payload) ?? {},
      resultPayload: safeJson<Record<string, unknown>>(r.result_payload) ?? undefined,
      error: r.error ?? undefined,
      createdBy: r.created_by ?? undefined,
      createdAt: r.created_at,
      processedAt: r.processed_at ?? undefined,
    }));
  }
}

function safeJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object' || typeof value === 'boolean' || typeof value === 'number') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

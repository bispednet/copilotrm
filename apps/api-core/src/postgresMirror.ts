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

export interface ChannelControlPeerRecord {
  channel: 'telegram' | 'whatsapp';
  peerId: string;
  profile?: Record<string, unknown>;
  lastPanel: string;
  awaitingInputFor?: string;
  lastSessionId?: string;
  updatedAt: string;
}

export interface ChannelControlEventRecord {
  id: string;
  channel: 'telegram' | 'whatsapp';
  peerId: string;
  kind: 'text' | 'action' | 'panel' | 'workflow' | 'system';
  label: string;
  createdAt: string;
}

export interface WorkspaceSyncRunRecord {
  id: string;
  source: 'google-workspace';
  reason: string;
  status: 'completed' | 'failed' | 'skipped';
  summary: Record<string, unknown>;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface WorkspaceSheetRowRecord {
  sourceKey: string;
  spreadsheetId: string;
  rangeName: string;
  kind: string;
  rowId: string;
  rowIndex: number;
  title: string;
  searchableText: string;
  payload: Record<string, string>;
  updatedAt: string;
}

export interface WorkspaceCalendarEventRecord {
  sourceKey: string;
  calendarId: string;
  eventId: string;
  kind: string;
  summary: string;
  startsAt?: string;
  endsAt?: string;
  attendees: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  searchableText: string;
  payload: Record<string, unknown>;
  updatedAt: string;
}

export interface WorkspaceOverviewRecord {
  configured: boolean;
  lastSyncAt?: string;
  sheetRows: number;
  calendarEvents: number;
  shiftRowsToday: number;
  upcomingMeetings: number;
}

export interface ControlCenterUserRecord {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'manager' | 'assist' | 'sales' | 'customer-care' | 'content' | 'viewer';
  status: 'active' | 'disabled';
  passwordHash: string;
  preferences?: Record<string, unknown>;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ControlCenterSessionRecord {
  token: string;
  userId: string;
  role: ControlCenterUserRecord['role'];
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ip?: string;
  userAgent?: string;
  user?: Pick<ControlCenterUserRecord, 'id' | 'email' | 'fullName' | 'role' | 'status'>;
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

  async saveChannelControlPeer(record: ChannelControlPeerRecord): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into channel_control_peers (channel, peer_id, profile, last_panel, awaiting_input_for, last_session_id, updated_at)
       values ($1,$2,$3::jsonb,$4,$5,$6,$7::timestamptz)
       on conflict (channel, peer_id) do update
       set profile=excluded.profile,
           last_panel=excluded.last_panel,
           awaiting_input_for=excluded.awaiting_input_for,
           last_session_id=excluded.last_session_id,
           updated_at=excluded.updated_at`,
      [
        record.channel,
        record.peerId,
        JSON.stringify(record.profile ?? {}),
        record.lastPanel,
        record.awaitingInputFor ?? null,
        record.lastSessionId ?? null,
        record.updatedAt,
      ]
    );
  }

  async loadChannelControlPeers(limit = 500): Promise<ChannelControlPeerRecord[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{
      channel: 'telegram' | 'whatsapp';
      peer_id: string;
      profile: unknown;
      last_panel: string;
      awaiting_input_for: string | null;
      last_session_id: string | null;
      updated_at: string;
    }>(
      `select channel, peer_id, profile, last_panel, awaiting_input_for, last_session_id, updated_at::text
       from channel_control_peers
       order by updated_at desc
       limit $1`,
      [limit]
    );
    return res.rows.map((row) => ({
      channel: row.channel,
      peerId: row.peer_id,
      profile: safeJson<Record<string, unknown>>(row.profile) ?? undefined,
      lastPanel: row.last_panel,
      awaitingInputFor: row.awaiting_input_for ?? undefined,
      lastSessionId: row.last_session_id ?? undefined,
      updatedAt: row.updated_at,
    }));
  }

  async saveChannelControlEvent(record: ChannelControlEventRecord): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into channel_control_events (id, channel, peer_id, kind, label, created_at)
       values ($1,$2,$3,$4,$5,$6::timestamptz)
       on conflict (id) do nothing`,
      [record.id, record.channel, record.peerId, record.kind, record.label, record.createdAt]
    );
  }

  async loadChannelControlEvents(limit = 1500): Promise<ChannelControlEventRecord[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{
      id: string;
      channel: 'telegram' | 'whatsapp';
      peer_id: string;
      kind: 'text' | 'action' | 'panel' | 'workflow' | 'system';
      label: string;
      created_at: string;
    }>(
      `select id, channel, peer_id, kind, label, created_at::text
       from channel_control_events
       order by created_at desc
       limit $1`,
      [limit]
    );
    return res.rows
      .reverse()
      .map((row) => ({
        id: row.id,
        channel: row.channel,
        peerId: row.peer_id,
        kind: row.kind,
        label: row.label,
        createdAt: row.created_at,
      }));
  }

  async saveWorkspaceSyncRun(record: WorkspaceSyncRunRecord): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into workspace_sync_runs (id, source, reason, status, summary, error, created_at, finished_at)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7::timestamptz,$8::timestamptz)
       on conflict (id) do update
       set status=excluded.status, summary=excluded.summary, error=excluded.error, finished_at=excluded.finished_at`,
      [
        record.id,
        record.source,
        record.reason,
        record.status,
        JSON.stringify(record.summary ?? {}),
        record.error ?? null,
        record.createdAt,
        record.finishedAt ?? null,
      ]
    );
  }

  async loadWorkspaceSyncRuns(limit = 25): Promise<WorkspaceSyncRunRecord[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{
      id: string;
      source: 'google-workspace';
      reason: string;
      status: 'completed' | 'failed' | 'skipped';
      summary: unknown;
      error: string | null;
      created_at: string;
      finished_at: string | null;
    }>(
      `select id, source, reason, status, summary, error, created_at::text, finished_at::text
       from workspace_sync_runs
       order by created_at desc
       limit $1`,
      [limit]
    );
    return res.rows.map((row) => ({
      id: row.id,
      source: row.source,
      reason: row.reason,
      status: row.status,
      summary: safeJson<Record<string, unknown>>(row.summary) ?? {},
      error: row.error ?? undefined,
      createdAt: row.created_at,
      finishedAt: row.finished_at ?? undefined,
    }));
  }

  async replaceWorkspaceSheetRows(sourceKey: string, rows: WorkspaceSheetRowRecord[]): Promise<void> {
    await this.replaceWorkspaceSheetRowsInternal(sourceKey, rows, false);
  }

  async replaceWorkspaceSheetRowsInternal(sourceKey: string, rows: WorkspaceSheetRowRecord[], merge: boolean): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    const client = await this.db.pool.connect();
    try {
      await client.query('begin');
      if (!merge) {
        await client.query('delete from workspace_sheet_rows where source_key = $1', [sourceKey]);
      }
      for (const row of rows) {
        await client.query(
          `insert into workspace_sheet_rows (source_key, spreadsheet_id, range_name, kind, row_id, row_index, title, searchable_text, payload, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)
           on conflict (source_key, row_id) do update
           set spreadsheet_id=excluded.spreadsheet_id,
               range_name=excluded.range_name,
               kind=excluded.kind,
               row_index=excluded.row_index,
               title=excluded.title,
               searchable_text=excluded.searchable_text,
               payload=excluded.payload,
               updated_at=excluded.updated_at`,
          [
            row.sourceKey,
            row.spreadsheetId,
            row.rangeName,
            row.kind,
            row.rowId,
            row.rowIndex,
            row.title,
            row.searchableText,
            JSON.stringify(row.payload ?? {}),
            row.updatedAt,
          ]
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async loadWorkspaceSheetRows(filters?: { kind?: string; query?: string; dayIso?: string; limit?: number }): Promise<WorkspaceSheetRowRecord[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters?.kind) {
      params.push(filters.kind);
      clauses.push(`kind = $${params.length}`);
    }
    if (filters?.query) {
      params.push(`%${filters.query.toLowerCase()}%`);
      clauses.push(`lower(searchable_text) like $${params.length}`);
    }
    if (filters?.dayIso) {
      params.push(filters.dayIso.slice(0, 10));
      clauses.push(`(
        lower(coalesce(payload->>'date', '')) like '%' || $${params.length} || '%'
        or lower(coalesce(payload->>'data', '')) like '%' || $${params.length} || '%'
        or lower(coalesce(payload->>'day', '')) like '%' || $${params.length} || '%'
        or lower(coalesce(payload->>'giorno', '')) like '%' || $${params.length} || '%'
      )`);
    }
    const limit = filters?.limit ?? 50;
    params.push(limit);
    const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
    const res = await this.db.pool.query<{
      source_key: string;
      spreadsheet_id: string;
      range_name: string;
      kind: string;
      row_id: string;
      row_index: number;
      title: string;
      searchable_text: string;
      payload: unknown;
      updated_at: string;
    }>(
      `select source_key, spreadsheet_id, range_name, kind, row_id, row_index, title, searchable_text, payload, updated_at::text
       from workspace_sheet_rows
       ${where}
       order by updated_at desc, row_index asc
       limit $${params.length}`,
      params
    );
    return res.rows.map((row) => ({
      sourceKey: row.source_key,
      spreadsheetId: row.spreadsheet_id,
      rangeName: row.range_name,
      kind: row.kind,
      rowId: row.row_id,
      rowIndex: row.row_index,
      title: row.title,
      searchableText: row.searchable_text,
      payload: safeJson<Record<string, string>>(row.payload) ?? {},
      updatedAt: row.updated_at,
    }));
  }

  async replaceWorkspaceCalendarEvents(sourceKey: string, events: WorkspaceCalendarEventRecord[], opts?: { merge?: boolean }): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    const merge = opts?.merge ?? false;
    const client = await this.db.pool.connect();
    try {
      await client.query('begin');
      if (!merge) {
        await client.query('delete from workspace_calendar_events where source_key = $1', [sourceKey]);
      }
      for (const event of events) {
        await client.query(
          `insert into workspace_calendar_events (source_key, calendar_id, event_id, kind, summary, starts_at, ends_at, attendees, searchable_text, payload, updated_at)
           values ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::jsonb,$9,$10::jsonb,$11::timestamptz)
           on conflict (source_key, event_id) do update
           set calendar_id=excluded.calendar_id,
               kind=excluded.kind,
               summary=excluded.summary,
               starts_at=excluded.starts_at,
               ends_at=excluded.ends_at,
               attendees=excluded.attendees,
               searchable_text=excluded.searchable_text,
               payload=excluded.payload,
               updated_at=excluded.updated_at`,
          [
            event.sourceKey,
            event.calendarId,
            event.eventId,
            event.kind,
            event.summary,
            event.startsAt ?? null,
            event.endsAt ?? null,
            JSON.stringify(event.attendees ?? []),
            event.searchableText,
            JSON.stringify(event.payload ?? {}),
            event.updatedAt,
          ]
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async loadWorkspaceCalendarEvents(filters?: { kind?: string; query?: string; fromIso?: string; toIso?: string; limit?: number }): Promise<WorkspaceCalendarEventRecord[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters?.kind) {
      params.push(filters.kind);
      clauses.push(`kind = $${params.length}`);
    }
    if (filters?.query) {
      params.push(`%${filters.query.toLowerCase()}%`);
      clauses.push(`lower(searchable_text) like $${params.length}`);
    }
    if (filters?.fromIso) {
      params.push(filters.fromIso);
      clauses.push(`coalesce(starts_at, updated_at) >= $${params.length}::timestamptz`);
    }
    if (filters?.toIso) {
      params.push(filters.toIso);
      clauses.push(`coalesce(starts_at, updated_at) <= $${params.length}::timestamptz`);
    }
    const limit = filters?.limit ?? 50;
    params.push(limit);
    const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
    const res = await this.db.pool.query<{
      source_key: string;
      calendar_id: string;
      event_id: string;
      kind: string;
      summary: string;
      starts_at: string | null;
      ends_at: string | null;
      attendees: unknown;
      searchable_text: string;
      payload: unknown;
      updated_at: string;
    }>(
      `select source_key, calendar_id, event_id, kind, summary, starts_at::text, ends_at::text, attendees, searchable_text, payload, updated_at::text
       from workspace_calendar_events
       ${where}
       order by coalesce(starts_at, updated_at) asc
       limit $${params.length}`,
      params
    );
    return res.rows.map((row) => ({
      sourceKey: row.source_key,
      calendarId: row.calendar_id,
      eventId: row.event_id,
      kind: row.kind,
      summary: row.summary,
      startsAt: row.starts_at ?? undefined,
      endsAt: row.ends_at ?? undefined,
      attendees: safeJson<Array<{ email?: string; displayName?: string; responseStatus?: string }>>(row.attendees) ?? [],
      searchableText: row.searchable_text,
      payload: safeJson<Record<string, unknown>>(row.payload) ?? {},
      updatedAt: row.updated_at,
    }));
  }

  async loadWorkspaceOverview(): Promise<WorkspaceOverviewRecord> {
    if (!(await this.ensureReady()) || !this.db) {
      return {
        configured: false,
        lastSyncAt: undefined,
        sheetRows: 0,
        calendarEvents: 0,
        shiftRowsToday: 0,
        upcomingMeetings: 0,
      };
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    const [summary, lastRun] = await Promise.all([
      this.db.pool.query<{
        sheet_rows: string;
        calendar_events: string;
        shift_rows_today: string;
        upcoming_meetings: string;
      }>(
        `select
          (select count(*)::text from workspace_sheet_rows) as sheet_rows,
          (select count(*)::text from workspace_calendar_events) as calendar_events,
          (select count(*)::text from workspace_sheet_rows
            where kind = 'shifts'
              and (
                lower(coalesce(payload->>'date', '')) like '%' || $1 || '%'
                or lower(coalesce(payload->>'data', '')) like '%' || $1 || '%'
                or lower(coalesce(payload->>'day', '')) like '%' || $1 || '%'
                or lower(coalesce(payload->>'giorno', '')) like '%' || $1 || '%'
              )) as shift_rows_today,
          (select count(*)::text from workspace_calendar_events
            where (kind = 'meetings' or attendees <> '[]'::jsonb)
              and coalesce(starts_at, updated_at) >= now()) as upcoming_meetings`,
        [todayIso]
      ),
      this.db.pool.query<{ finished_at: string | null }>(
        `select finished_at::text
         from workspace_sync_runs
         where status = 'completed'
         order by finished_at desc nulls last
         limit 1`
      ),
    ]);
    return {
      configured: true,
      lastSyncAt: lastRun.rows[0]?.finished_at ?? undefined,
      sheetRows: Number(summary.rows[0]?.sheet_rows ?? 0),
      calendarEvents: Number(summary.rows[0]?.calendar_events ?? 0),
      shiftRowsToday: Number(summary.rows[0]?.shift_rows_today ?? 0),
      upcomingMeetings: Number(summary.rows[0]?.upcoming_meetings ?? 0),
    };
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
      'channel_control_peers',
      'channel_control_events',
      'workspace_sync_runs',
      'workspace_sheet_rows',
      'workspace_calendar_events',
      'control_center_users',
      'control_center_sessions',
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

  async countControlCenterUsers(): Promise<number> {
    if (!(await this.ensureReady()) || !this.db) return 0;
    const res = await this.db.pool.query<{ count: string }>('select count(*)::text as count from control_center_users');
    return Number(res.rows[0]?.count ?? 0);
  }

  async loadControlCenterUsers(): Promise<ControlCenterUserRecord[]> {
    if (!(await this.ensureReady()) || !this.db) return [];
    const res = await this.db.pool.query<{
      id: string;
      email: string;
      full_name: string;
      role: ControlCenterUserRecord['role'];
      status: ControlCenterUserRecord['status'];
      password_hash: string;
      preferences: unknown;
      last_login_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `select id, email, full_name, role, status, password_hash, preferences, last_login_at::text, created_at::text, updated_at::text
       from control_center_users
       order by created_at asc`
    );
    return res.rows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      status: row.status,
      passwordHash: row.password_hash,
      preferences: safeJson<Record<string, unknown>>(row.preferences) ?? {},
      lastLoginAt: row.last_login_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getControlCenterUserByEmail(email: string): Promise<ControlCenterUserRecord | null> {
    if (!(await this.ensureReady()) || !this.db) return null;
    const res = await this.db.pool.query<{
      id: string;
      email: string;
      full_name: string;
      role: ControlCenterUserRecord['role'];
      status: ControlCenterUserRecord['status'];
      password_hash: string;
      preferences: unknown;
      last_login_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `select id, email, full_name, role, status, password_hash, preferences, last_login_at::text, created_at::text, updated_at::text
       from control_center_users
       where lower(email) = lower($1)
       limit 1`,
      [email]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      status: row.status,
      passwordHash: row.password_hash,
      preferences: safeJson<Record<string, unknown>>(row.preferences) ?? {},
      lastLoginAt: row.last_login_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getControlCenterUserById(id: string): Promise<ControlCenterUserRecord | null> {
    if (!(await this.ensureReady()) || !this.db) return null;
    const res = await this.db.pool.query<{
      id: string;
      email: string;
      full_name: string;
      role: ControlCenterUserRecord['role'];
      status: ControlCenterUserRecord['status'];
      password_hash: string;
      preferences: unknown;
      last_login_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `select id, email, full_name, role, status, password_hash, preferences, last_login_at::text, created_at::text, updated_at::text
       from control_center_users
       where id = $1
       limit 1`,
      [id]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      status: row.status,
      passwordHash: row.password_hash,
      preferences: safeJson<Record<string, unknown>>(row.preferences) ?? {},
      lastLoginAt: row.last_login_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async saveControlCenterUser(user: ControlCenterUserRecord): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into control_center_users (id, email, full_name, role, status, password_hash, preferences, last_login_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9::timestamptz,$10::timestamptz)
       on conflict (id) do update
       set email=excluded.email,
           full_name=excluded.full_name,
           role=excluded.role,
           status=excluded.status,
           password_hash=excluded.password_hash,
           preferences=excluded.preferences,
           last_login_at=excluded.last_login_at,
           updated_at=excluded.updated_at`,
      [
        user.id,
        user.email,
        user.fullName,
        user.role,
        user.status,
        user.passwordHash,
        JSON.stringify(user.preferences ?? {}),
        user.lastLoginAt ?? null,
        user.createdAt,
        user.updatedAt,
      ],
    );
  }

  async saveControlCenterSession(session: ControlCenterSessionRecord): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `insert into control_center_sessions (token, user_id, role, issued_at, expires_at, last_seen_at, ip, user_agent)
       values ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6::timestamptz,$7,$8)
       on conflict (token) do update
       set role=excluded.role,
           expires_at=excluded.expires_at,
           last_seen_at=excluded.last_seen_at,
           ip=excluded.ip,
           user_agent=excluded.user_agent`,
      [
        session.token,
        session.userId,
        session.role,
        session.issuedAt,
        session.expiresAt,
        session.lastSeenAt,
        session.ip ?? null,
        session.userAgent ?? null,
      ],
    );
  }

  async getControlCenterSession(token: string): Promise<ControlCenterSessionRecord | null> {
    if (!(await this.ensureReady()) || !this.db) return null;
    const res = await this.db.pool.query<{
      token: string;
      user_id: string;
      role: ControlCenterUserRecord['role'];
      issued_at: string;
      expires_at: string;
      last_seen_at: string;
      ip: string | null;
      user_agent: string | null;
      user_email: string;
      user_full_name: string;
      user_role: ControlCenterUserRecord['role'];
      user_status: ControlCenterUserRecord['status'];
    }>(
      `select s.token, s.user_id, s.role, s.issued_at::text, s.expires_at::text, s.last_seen_at::text, s.ip, s.user_agent,
              u.email as user_email, u.full_name as user_full_name, u.role as user_role, u.status as user_status
       from control_center_sessions s
       join control_center_users u on u.id = s.user_id
       where s.token = $1
       limit 1`,
      [token],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      token: row.token,
      userId: row.user_id,
      role: row.role,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
      ip: row.ip ?? undefined,
      userAgent: row.user_agent ?? undefined,
      user: {
        id: row.user_id,
        email: row.user_email,
        fullName: row.user_full_name,
        role: row.user_role,
        status: row.user_status,
      },
    };
  }

  async touchControlCenterSession(token: string, seenAt: string): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query(
      `update control_center_sessions set last_seen_at = $2::timestamptz where token = $1`,
      [token, seenAt],
    );
  }

  async deleteControlCenterSession(token: string): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query('delete from control_center_sessions where token = $1', [token]);
  }

  async deleteExpiredControlCenterSessions(): Promise<void> {
    if (!(await this.ensureReady()) || !this.db) return;
    await this.db.pool.query('delete from control_center_sessions where expires_at < now()');
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

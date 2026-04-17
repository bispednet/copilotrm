import { logger } from '@bisp/shared-logger';
import type { LLMClient, LLMMessage } from '@bisp/integrations-llm';
import {
  GoogleWorkspaceClient,
  loadGoogleWorkspaceConfig,
  type GoogleWorkspaceConfig,
  type WorkspaceCalendarEvent,
  type WorkspaceMeetingCreateResult,
  type WorkspaceMeetingDraft,
  type WorkspaceSheetRow,
} from '@bisp/integrations-google-workspace';
import type {
  WorkspaceCalendarEventRecord,
  WorkspaceOverviewRecord,
  WorkspaceSheetRowRecord,
  WorkspaceSyncRunRecord,
} from './postgresMirror';
import type { PostgresMirror } from './postgresMirror';

export interface WorkspaceQueryResult {
  handled: boolean;
  text: string;
  trace?: string;
}

export interface WorkspaceAdminSnapshot {
  summary: WorkspaceOverviewRecord;
  nextEvents: WorkspaceCalendarEventRecord[];
  todayShifts: WorkspaceSheetRowRecord[];
  latestSyncRuns: WorkspaceSyncRunRecord[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function asDate(input: string | undefined): Date | null {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(input: string | undefined, timezone: string): string {
  const date = asDate(input);
  if (!date) return 'n/d';
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatCompactDate(input: string | undefined, timezone: string): string {
  const date = asDate(input);
  if (!date) return 'n/d';
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

function containsAny(input: string, parts: string[]): boolean {
  return parts.some((part) => input.includes(part));
}

function normalizeText(input: string): string {
  return input.normalize('NFKD').replace(/[^\p{L}\p{N}\s:@._-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function startOfDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMinutes(date: Date, minutes: number): Date {
  const next = new Date(date.getTime());
  next.setUTCMinutes(next.getUTCMinutes() + minutes);
  return next;
}

function extractEmails(text: string): string[] {
  return [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0]).filter(Boolean);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function rowField(row: WorkspaceSheetRowRecord, ...keys: string[]): string | undefined {
  const values = row.payload;
  for (const key of keys) {
    const direct = values[key];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
  }
  return undefined;
}

function rowDateValue(row: WorkspaceSheetRowRecord): string | undefined {
  return rowField(row, 'date', 'giorno', 'day', 'data', 'shift_date', 'appointment_date');
}

function rowMatchesDay(row: WorkspaceSheetRowRecord, target: Date): boolean {
  const value = rowDateValue(row);
  if (!value) return false;
  const parsed = asDate(value);
  if (!parsed) {
    const todayKey = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit' }).format(target);
    return value.toLowerCase().includes(todayKey.toLowerCase());
  }
  return parsed.toISOString().slice(0, 10) === target.toISOString().slice(0, 10);
}

async function chatWithContext(llm: LLMClient, system: string, user: string): Promise<string> {
  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const response = await llm.chat(messages, {
    tier: 'small',
    temperature: 0.2,
    maxTokens: 420,
    sessionKey: 'workspace-runtime',
    sessionLabel: 'Workspace runtime',
  });
  return response.content.trim();
}

async function parseMeetingWithLlm(
  llm: LLMClient,
  text: string,
  config: GoogleWorkspaceConfig,
): Promise<WorkspaceMeetingDraft | null> {
  const now = nowIso();
  const system = [
    'You extract structured Google Calendar meeting data from an Italian natural-language request.',
    'Return JSON only.',
    `Timezone: ${config.timezone}.`,
    `Current timestamp: ${now}.`,
    `Default duration minutes: ${config.meetingDefaultDurationMinutes}.`,
    'Schema:',
    '{',
    '  "summary": "required string",',
    '  "description": "optional string",',
    '  "startAt": "required ISO datetime",',
    '  "endAt": "required ISO datetime",',
    '  "attendees": ["optional@email"],',
    '  "location": "optional string"',
    '}',
    'If the request is unclear and you cannot infer a start time, return {"error":"clear request needed"}.',
  ].join('\n');
  const content = await chatWithContext(llm, system, text);
  try {
    const parsed = JSON.parse(content) as Partial<WorkspaceMeetingDraft> & { error?: string };
    if (parsed.error) return null;
    if (!parsed.summary || !parsed.startAt || !parsed.endAt) return null;
    return {
      summary: parsed.summary,
      description: parsed.description,
      startAt: parsed.startAt,
      endAt: parsed.endAt,
      attendees: Array.isArray(parsed.attendees) ? parsed.attendees.filter((value): value is string => typeof value === 'string') : undefined,
      location: parsed.location,
    };
  } catch {
    return null;
  }
}

function parseMeetingFallback(text: string, config: GoogleWorkspaceConfig): WorkspaceMeetingDraft | null {
  const normalized = normalizeText(text);
  const baseDate = new Date();
  let day = startOfDay(baseDate);
  if (normalized.includes('dopodomani')) day = addDays(day, 2);
  else if (normalized.includes('domani')) day = addDays(day, 1);
  else if (normalized.includes('oggi') || normalized.includes('stasera')) day = day;
  else {
    const explicitDate = text.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
    if (explicitDate) {
      const dayPart = Number(explicitDate[1]);
      const monthPart = Number(explicitDate[2]) - 1;
      const yearPart = explicitDate[3] ? Number(explicitDate[3].length === 2 ? `20${explicitDate[3]}` : explicitDate[3]) : baseDate.getUTCFullYear();
      day = new Date(Date.UTC(yearPart, monthPart, dayPart, 0, 0, 0, 0));
    }
  }

  const timeMatch = text.match(/\b(?:alle|ore)?\s*(\d{1,2})(?::|\.|,)?(\d{2})?\b/i);
  if (!timeMatch) return null;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] ?? '0');
  const startAt = new Date(day.getTime());
  startAt.setUTCHours(hour, minute, 0, 0);

  const durationMatch = text.match(/\b(\d{1,3})\s*(?:min|mins|minuti|minutes)\b/i);
  const durationMinutes = durationMatch ? Number(durationMatch[1]) : config.meetingDefaultDurationMinutes;
  const endAt = addMinutes(startAt, durationMinutes);

  const summary =
    firstNonEmpty(
      text.match(/riunione\s+(.+)/i)?.[1],
      text.match(/meeting\s+(.+)/i)?.[1],
      text.replace(/domani|oggi|dopodomani/gi, '').replace(/\balle\b|\bore\b/gi, '').trim(),
    ) ?? 'Riunione AIRI';

  return {
    summary: summary.slice(0, 120),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    attendees: extractEmails(text),
  };
}

export class WorkspaceRuntime {
  private readonly client: GoogleWorkspaceClient;
  private readonly postgresMirror: PostgresMirror;
  private readonly llm: LLMClient | null;
  private readonly config: GoogleWorkspaceConfig;
  private timer: NodeJS.Timeout | null = null;
  private inMemorySheetRows: WorkspaceSheetRowRecord[] = [];
  private inMemoryCalendarEvents: WorkspaceCalendarEventRecord[] = [];
  private inMemorySyncRuns: WorkspaceSyncRunRecord[] = [];
  private inMemorySummary: WorkspaceOverviewRecord = {
    configured: false,
    lastSyncAt: undefined,
    sheetRows: 0,
    calendarEvents: 0,
    shiftRowsToday: 0,
    upcomingMeetings: 0,
  };

  constructor(opts: { postgresMirror: PostgresMirror; llm: LLMClient | null; env?: Record<string, string | undefined> }) {
    this.config = loadGoogleWorkspaceConfig(opts.env);
    this.client = new GoogleWorkspaceClient(this.config);
    this.postgresMirror = opts.postgresMirror;
    this.llm = opts.llm;
  }

  get configured(): boolean {
    return this.client.configured && (this.config.sheetSources.length > 0 || this.config.calendarSources.length > 0);
  }

  async hydrate(): Promise<void> {
    const [summary, rows, events, runs] = await Promise.all([
      this.postgresMirror.loadWorkspaceOverview(),
      this.postgresMirror.loadWorkspaceSheetRows({ limit: 500 }),
      this.postgresMirror.loadWorkspaceCalendarEvents({ limit: 500 }),
      this.postgresMirror.loadWorkspaceSyncRuns(25),
    ]);
    if (summary.sheetRows > 0 || summary.calendarEvents > 0 || summary.lastSyncAt) {
      this.inMemorySummary = summary;
    }
    if (rows.length > 0) this.inMemorySheetRows = rows;
    if (events.length > 0) this.inMemoryCalendarEvents = events;
    if (runs.length > 0) this.inMemorySyncRuns = runs;
  }

  private computeSummaryFromMemory(lastSyncAt?: string): WorkspaceOverviewRecord {
    const todayKey = startOfDay(new Date()).toISOString().slice(0, 10);
    const shiftRowsToday = this.inMemorySheetRows.filter((row) => row.kind === 'shifts' && rowMatchesDay(row, startOfDay(new Date()))).length;
    const upcomingMeetings = this.inMemoryCalendarEvents.filter((event) => {
      const startsAt = event.startsAt ? event.startsAt.slice(0, 10) : undefined;
      return (event.kind === 'meetings' || event.attendees.length > 0) && (!!startsAt ? startsAt >= todayKey : true);
    }).length;
    return {
      configured: this.configured,
      lastSyncAt,
      sheetRows: this.inMemorySheetRows.length,
      calendarEvents: this.inMemoryCalendarEvents.length,
      shiftRowsToday,
      upcomingMeetings,
    };
  }

  private selectSheetRows(filters?: { kind?: string; query?: string; dayIso?: string; limit?: number }): WorkspaceSheetRowRecord[] {
    let rows = [...this.inMemorySheetRows];
    if (filters?.kind) rows = rows.filter((row) => row.kind === filters.kind);
    if (filters?.query) {
      const query = filters.query.toLowerCase();
      rows = rows.filter((row) => row.searchableText.toLowerCase().includes(query) || row.title.toLowerCase().includes(query));
    }
    if (filters?.dayIso) {
      const target = asDate(filters.dayIso) ?? new Date(filters.dayIso);
      rows = rows.filter((row) => rowMatchesDay(row, target));
    }
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.rowIndex - b.rowIndex);
    return rows.slice(0, filters?.limit ?? 50);
  }

  private selectCalendarEvents(filters?: { kind?: string; query?: string; fromIso?: string; toIso?: string; limit?: number }): WorkspaceCalendarEventRecord[] {
    let events = [...this.inMemoryCalendarEvents];
    if (filters?.kind) events = events.filter((event) => event.kind === filters.kind);
    if (filters?.query) {
      const query = filters.query.toLowerCase();
      events = events.filter((event) => event.searchableText.toLowerCase().includes(query) || event.summary.toLowerCase().includes(query));
    }
    if (filters?.fromIso) {
      const fromMs = asDate(filters.fromIso)?.getTime();
      if (fromMs) {
        events = events.filter((event) => {
          const eventMs = asDate(event.startsAt ?? event.updatedAt)?.getTime();
          return !eventMs || eventMs >= fromMs;
        });
      }
    }
    if (filters?.toIso) {
      const toMs = asDate(filters.toIso)?.getTime();
      if (toMs) {
        events = events.filter((event) => {
          const eventMs = asDate(event.startsAt ?? event.updatedAt)?.getTime();
          return !eventMs || eventMs <= toMs;
        });
      }
    }
    events.sort((a, b) => (asDate(a.startsAt ?? a.updatedAt)?.getTime() ?? 0) - (asDate(b.startsAt ?? b.updatedAt)?.getTime() ?? 0));
    return events.slice(0, filters?.limit ?? 50);
  }

  async syncNow(reason: string): Promise<WorkspaceOverviewRecord> {
    const startedAt = nowIso();
    const runId = `wsync_${Date.now().toString(36)}`;
    if (!this.configured) {
      const summary = await this.postgresMirror.loadWorkspaceOverview();
      await this.postgresMirror.saveWorkspaceSyncRun({
        id: runId,
        source: 'google-workspace',
        reason,
        status: 'skipped',
        summary: summary as unknown as Record<string, unknown>,
        error: 'Google Workspace not configured',
        createdAt: startedAt,
        finishedAt: nowIso(),
      });
      return summary;
    }

    try {
      const windowStart = addDays(startOfDay(new Date()), -2).toISOString();
      const windowEnd = addDays(startOfDay(new Date()), 14).toISOString();
      const sheetSnapshots = await Promise.all(this.config.sheetSources.map((source) => this.client.fetchSheetSnapshot(source)));
      const calendarSnapshots = await Promise.all(this.config.calendarSources.map((source) => this.client.fetchCalendarSnapshot(source, windowStart, windowEnd)));
      this.inMemorySheetRows = sheetSnapshots.flatMap((snapshot) =>
        snapshot.rows.map((row) => ({
          sourceKey: snapshot.sourceKey,
          spreadsheetId: snapshot.spreadsheetId,
          rangeName: snapshot.range,
          kind: snapshot.kind,
          rowId: row.rowId,
          rowIndex: row.rowIndex,
          title: row.title,
          searchableText: row.searchableText,
          payload: row.values,
          updatedAt: startedAt,
        }))
      );
      this.inMemoryCalendarEvents = calendarSnapshots.flatMap((snapshot) =>
        snapshot.events.map((event) => ({
          sourceKey: snapshot.sourceKey,
          calendarId: snapshot.calendarId,
          eventId: event.eventId,
          kind: event.kind,
          summary: event.title,
          startsAt: event.startAt,
          endsAt: event.endAt,
          attendees: event.attendees,
          searchableText: event.searchableText,
          payload: event.payload,
          updatedAt: startedAt,
        }))
      );

      for (const snapshot of sheetSnapshots) {
        await this.postgresMirror.replaceWorkspaceSheetRows(
          snapshot.sourceKey,
          this.inMemorySheetRows.filter((row) => row.sourceKey === snapshot.sourceKey),
        );
      }

      for (const snapshot of calendarSnapshots) {
        await this.postgresMirror.replaceWorkspaceCalendarEvents(
          snapshot.sourceKey,
          this.inMemoryCalendarEvents.filter((event) => event.sourceKey === snapshot.sourceKey),
        );
      }

      const summary = await this.postgresMirror.loadWorkspaceOverview();
      this.inMemorySummary = summary.sheetRows > 0 || summary.calendarEvents > 0 ? summary : this.computeSummaryFromMemory(nowIso());
      const completedRun: WorkspaceSyncRunRecord = {
        id: runId,
        source: 'google-workspace',
        reason,
        status: 'completed',
        summary: this.inMemorySummary as unknown as Record<string, unknown>,
        createdAt: startedAt,
        finishedAt: nowIso(),
      };
      this.inMemorySyncRuns = [completedRun, ...this.inMemorySyncRuns].slice(0, 25);
      await this.postgresMirror.saveWorkspaceSyncRun({
        ...completedRun,
      });
      return this.inMemorySummary;
    } catch (error) {
      const summary = await this.postgresMirror.loadWorkspaceOverview();
      this.inMemorySummary = summary.sheetRows > 0 || summary.calendarEvents > 0 ? summary : this.computeSummaryFromMemory(this.inMemorySummary.lastSyncAt);
      const failedRun: WorkspaceSyncRunRecord = {
        id: runId,
        source: 'google-workspace',
        reason,
        status: 'failed',
        summary: this.inMemorySummary as unknown as Record<string, unknown>,
        error: error instanceof Error ? error.message : String(error),
        createdAt: startedAt,
        finishedAt: nowIso(),
      };
      this.inMemorySyncRuns = [failedRun, ...this.inMemorySyncRuns].slice(0, 25);
      await this.postgresMirror.saveWorkspaceSyncRun(failedRun);
      logger.warn('workspace sync failed', { error: error instanceof Error ? error.message : String(error) });
      return this.inMemorySummary;
    }
  }

  start(): void {
    if (!this.configured || this.timer) return;
    this.timer = setInterval(() => {
      void this.syncNow('scheduled');
    }, this.config.syncIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async buildAdminSnapshot(): Promise<WorkspaceAdminSnapshot> {
    const summary = await this.postgresMirror.loadWorkspaceOverview();
    const [dbNextEvents, dbTodayShifts, dbLatestSyncRuns] = await Promise.all([
      this.postgresMirror.loadWorkspaceCalendarEvents({ fromIso: nowIso(), limit: 12 }),
      this.postgresMirror.loadWorkspaceSheetRows({ kind: 'shifts', dayIso: startOfDay(new Date()).toISOString(), limit: 20 }),
      this.postgresMirror.loadWorkspaceSyncRuns(12),
    ]);
    return {
      summary: summary.sheetRows > 0 || summary.calendarEvents > 0 || summary.lastSyncAt ? summary : this.inMemorySummary,
      nextEvents: dbNextEvents.length > 0 ? dbNextEvents : this.selectCalendarEvents({ fromIso: nowIso(), limit: 12 }),
      todayShifts: dbTodayShifts.length > 0 ? dbTodayShifts : this.selectSheetRows({ kind: 'shifts', dayIso: startOfDay(new Date()).toISOString(), limit: 20 }),
      latestSyncRuns: dbLatestSyncRuns.length > 0 ? dbLatestSyncRuns : this.inMemorySyncRuns.slice(0, 12),
    };
  }

  private renderAgenda(events: WorkspaceCalendarEventRecord[], label: string): string {
    if (events.length === 0) {
      return `${label}\n\nNo events found.`;
    }
    return [
      label,
      '',
      ...events.map((event, index) => {
        const slot = `${formatDateTime(event.startsAt, this.config.timezone)} → ${formatDateTime(event.endsAt, this.config.timezone)}`;
        const attendees = event.attendees.length ? ` · ${event.attendees.map((attendee) => attendee.displayName ?? attendee.email ?? '').filter(Boolean).slice(0, 3).join(', ')}` : '';
        return `${index + 1}. ${event.summary} · ${slot}${attendees}`;
      }),
    ].join('\n');
  }

  private renderShifts(rows: WorkspaceSheetRowRecord[], label: string): string {
    if (rows.length === 0) {
      return `${label}\n\nNo shift rows found.`;
    }
    return [
      label,
      '',
      ...rows.map((row, index) => {
        const employee = rowField(row, 'employee', 'nome', 'name', 'dipendente') ?? row.title;
        const role = rowField(row, 'role', 'ruolo');
        const from = rowField(row, 'start', 'inizio', 'from', 'ora_inizio');
        const to = rowField(row, 'end', 'fine', 'to', 'ora_fine');
        const notes = rowField(row, 'notes', 'note', 'commenti');
        return `${index + 1}. ${employee}${role ? ` · ${role}` : ''}${from || to ? ` · ${from ?? '--'}-${to ?? '--'}` : ''}${notes ? ` · ${notes}` : ''}`;
      }),
    ].join('\n');
  }

  private async answerGroundedQuestion(text: string, rows: WorkspaceSheetRowRecord[], events: WorkspaceCalendarEventRecord[]): Promise<string> {
    const context = [
      `Timezone: ${this.config.timezone}`,
      '',
      'Sheet rows:',
      ...(rows.length > 0 ? rows.map((row, index) => `${index + 1}. [${row.kind}] ${row.title} :: ${row.searchableText}`) : ['none']),
      '',
      'Calendar events:',
      ...(events.length > 0 ? events.map((event, index) => `${index + 1}. [${event.kind}] ${event.summary} :: ${event.searchableText} :: ${event.startsAt ?? ''} -> ${event.endsAt ?? ''}`) : ['none']),
    ].join('\n');

    if (!this.llm) {
      return [
        'Workspace context',
        '',
        context,
        '',
        `Question: ${text}`,
      ].join('\n');
    }

    return chatWithContext(
      this.llm,
      [
        'You are a business operations copilot.',
        'Answer in Italian.',
        'Use only the provided workspace context.',
        'If the context is insufficient, say so explicitly and ask for the missing detail.',
        'Keep the answer direct and operational, written for non-technical staff.',
        '',
        context,
      ].join('\n'),
      text,
    );
  }

  async answerWorkspaceQuery(text: string): Promise<WorkspaceQueryResult> {
    const normalized = normalizeText(text);
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    const nextWeek = addDays(today, 7);
    const wantsMeetingCreate = containsAny(normalized, ['crea riunione', 'organizza riunione', 'fissa riunione', 'crea meeting', 'organizza meeting', 'invita']);
    if (wantsMeetingCreate) {
      return this.createMeetingFromText(text);
    }

    const wantsShifts = containsAny(normalized, ['turno', 'turni', 'chi lavora', 'chi e di turno', 'chi è di turno', 'orari dipendenti', 'orari staff']);
    if (wantsShifts) {
      const shifts = (() => {
        const selected = this.selectSheetRows({ kind: 'shifts', dayIso: today.toISOString(), limit: 20 });
        return selected;
      })();
      return { handled: true, text: this.renderShifts(shifts, 'Turni di oggi'), trace: 'User request: Shifts today' };
    }

    const wantsTodayAgenda = containsAny(normalized, ['agenda oggi', 'appuntamenti oggi', 'riunioni oggi', 'meeting oggi', 'oggi']);
    const wantsUpcomingAgenda = containsAny(normalized, ['domani', 'agenda domani', 'agenda settimana', 'prossimi appuntamenti', 'upcoming', 'questa settimana']);
    if (containsAny(normalized, ['agenda', 'appuntamenti', 'riunioni', 'meeting', 'calendar', 'calendario'])) {
      const fromIso = wantsUpcomingAgenda && !wantsTodayAgenda ? tomorrow.toISOString() : today.toISOString();
      const toIso = wantsUpcomingAgenda && !wantsTodayAgenda ? nextWeek.toISOString() : addDays(today, 1).toISOString();
      const events = this.selectCalendarEvents({ fromIso, toIso, limit: 20 });
      return {
        handled: true,
        text: this.renderAgenda(events, wantsUpcomingAgenda && !wantsTodayAgenda ? 'Agenda prossimi giorni' : 'Agenda di oggi'),
        trace: `User request: ${wantsUpcomingAgenda && !wantsTodayAgenda ? 'Upcoming agenda' : 'Agenda today'}`,
      };
    }

    const workspaceKeywords = ['foglio', 'sheet', 'sheets', 'google', 'calendar', 'calendario', 'turni', 'turno', 'appuntamenti', 'meeting', 'riunione', 'agenda', 'dipendenti', 'employee'];
    if (!containsAny(normalized, workspaceKeywords)) {
      return { handled: false, text: '' };
    }

    const rows = this.selectSheetRows({ query: normalized, limit: 16 });
    const events = this.selectCalendarEvents({ query: normalized, fromIso: addDays(today, -2).toISOString(), limit: 16 });

    return {
      handled: true,
      text: await this.answerGroundedQuestion(text, rows, events),
      trace: 'User request: Ask workspace',
    };
  }

  async createMeetingFromText(text: string): Promise<WorkspaceQueryResult> {
    if (!this.configured) {
      return { handled: true, text: 'Google Workspace is not configured yet.', trace: 'User request: Create meeting' };
    }
    const draft =
      (this.llm ? await parseMeetingWithLlm(this.llm, text, this.config) : null) ??
      parseMeetingFallback(text, this.config);

    if (!draft) {
      return {
        handled: true,
        text: 'I need a clearer meeting request. Example: "Domani alle 10:30 riunione commerciale con mario@azienda.it per 45 minuti".',
        trace: 'User request: Create meeting',
      };
    }

    const result = await this.client.createMeeting(draft);
    if (!result.ok || !result.event) {
      return {
        handled: true,
        text: `Meeting creation failed: ${result.error ?? 'unknown error'}`,
        trace: 'User request: Create meeting',
      };
    }

    await this.postgresMirror.replaceWorkspaceCalendarEvents(result.event.sourceKey, [
      {
        sourceKey: result.event.sourceKey,
        calendarId: result.event.calendarId,
        eventId: result.event.eventId,
        kind: result.event.kind,
        summary: result.event.title,
        startsAt: result.event.startAt,
        endsAt: result.event.endAt,
        attendees: result.event.attendees,
        searchableText: result.event.searchableText,
        payload: result.event.payload,
        updatedAt: nowIso(),
      },
    ], { merge: true });
    const existingWithoutCurrent = this.inMemoryCalendarEvents.filter((event) => !(event.sourceKey === result.event!.sourceKey && event.eventId === result.event!.eventId));
    this.inMemoryCalendarEvents = [
      ...existingWithoutCurrent,
      {
        sourceKey: result.event.sourceKey,
        calendarId: result.event.calendarId,
        eventId: result.event.eventId,
        kind: result.event.kind,
        summary: result.event.title,
        startsAt: result.event.startAt,
        endsAt: result.event.endAt,
        attendees: result.event.attendees,
        searchableText: result.event.searchableText,
        payload: result.event.payload,
        updatedAt: nowIso(),
      },
    ].sort((a, b) => (asDate(a.startsAt ?? a.updatedAt)?.getTime() ?? 0) - (asDate(b.startsAt ?? b.updatedAt)?.getTime() ?? 0));
    this.inMemorySummary = this.computeSummaryFromMemory(nowIso());

    return {
      handled: true,
      text: [
        `Meeting created: ${result.event.title}`,
        `${formatDateTime(result.event.startAt, this.config.timezone)} → ${formatDateTime(result.event.endAt, this.config.timezone)}`,
        result.htmlLink ? result.htmlLink : null,
      ].filter(Boolean).join('\n'),
      trace: 'User request: Create meeting',
    };
  }
}

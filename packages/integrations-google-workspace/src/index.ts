import { JWT } from 'google-auth-library';

export type GoogleSheetSourceKind = 'knowledge' | 'shifts' | 'appointments' | 'employees' | 'generic';
export type GoogleCalendarSourceKind = 'agenda' | 'appointments' | 'meetings' | 'shared';

export interface GoogleSheetSourceConfig {
  spreadsheetId: string;
  range: string;
  title?: string;
  kind?: GoogleSheetSourceKind;
}

export interface GoogleCalendarSourceConfig {
  calendarId: string;
  title?: string;
  kind?: GoogleCalendarSourceKind;
}

export interface GoogleWorkspaceConfig {
  serviceAccountEmail?: string;
  privateKey?: string;
  impersonatedUser?: string;
  timezone: string;
  syncIntervalMs: number;
  defaultCalendarId?: string;
  meetingDefaultDurationMinutes: number;
  meetingSendUpdates: 'all' | 'externalOnly' | 'none';
  sheetSources: GoogleSheetSourceConfig[];
  calendarSources: GoogleCalendarSourceConfig[];
}

export interface WorkspaceSheetRow {
  rowId: string;
  rowIndex: number;
  title: string;
  searchableText: string;
  values: Record<string, string>;
  raw: string[];
}

export interface WorkspaceSheetSnapshot {
  sourceKey: string;
  spreadsheetId: string;
  range: string;
  title: string;
  kind: GoogleSheetSourceKind;
  rows: WorkspaceSheetRow[];
}

export interface WorkspaceCalendarEvent {
  sourceKey: string;
  calendarId: string;
  eventId: string;
  kind: GoogleCalendarSourceKind;
  title: string;
  description?: string;
  status?: string;
  location?: string;
  meetingLink?: string;
  startAt?: string;
  endAt?: string;
  attendees: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  searchableText: string;
  payload: Record<string, unknown>;
}

export interface WorkspaceCalendarSnapshot {
  sourceKey: string;
  calendarId: string;
  title: string;
  kind: GoogleCalendarSourceKind;
  events: WorkspaceCalendarEvent[];
}

export interface WorkspaceMeetingDraft {
  summary: string;
  description?: string;
  startAt: string;
  endAt: string;
  attendees?: string[];
  location?: string;
  calendarId?: string;
}

export interface WorkspaceMeetingCreateResult {
  ok: boolean;
  calendarId?: string;
  eventId?: string;
  htmlLink?: string;
  event?: WorkspaceCalendarEvent;
  error?: string;
}

function parseJsonArray<T>(raw: string | undefined): T[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function normalizePrivateKey(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  return raw.replace(/\\n/g, '\n');
}

function cleanCell(value: unknown): string {
  return String(value ?? '').trim();
}

function slugify(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
  return normalized || 'column';
}

function buildSourceKey(prefix: 'sheet' | 'calendar', primary: string, secondary: string): string {
  return `${prefix}:${primary}:${secondary}`;
}

function buildSheetRows(values: string[][]): WorkspaceSheetRow[] {
  const normalizedRows = values
    .map((row) => row.map(cleanCell))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (normalizedRows.length === 0) return [];

  const headers = normalizedRows[0].map((value, index) => slugify(value || `column_${index + 1}`));
  return normalizedRows.slice(1).map((row, index) => {
    const valuesRecord: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      valuesRecord[header] = cleanCell(row[headerIndex] ?? '');
    });
    const title =
      valuesRecord.name ||
      valuesRecord.employee ||
      valuesRecord.nome ||
      valuesRecord.summary ||
      valuesRecord.title ||
      row.find((cell) => cell.length > 0) ||
      `Row ${index + 2}`;
    const searchableText = Object.entries(valuesRecord)
      .map(([key, value]) => `${key} ${value}`)
      .join(' ')
      .trim();
    return {
      rowId: `${index + 2}`,
      rowIndex: index + 2,
      title,
      searchableText,
      values: valuesRecord,
      raw: row,
    };
  });
}

function toIsoDateTime(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as { dateTime?: string; date?: string };
  return input.dateTime ?? input.date;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function loadGoogleWorkspaceConfig(
  env: Record<string, string | undefined> = (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  )
): GoogleWorkspaceConfig {
  const syncIntervalMs = Number(env.BISPCRM_GOOGLE_SYNC_INTERVAL_MS ?? 300_000);
  const meetingDefaultDurationMinutes = Number(env.BISPCRM_GOOGLE_MEETING_DURATION_MINUTES ?? 45);
  const meetingSendUpdatesRaw = String(env.BISPCRM_GOOGLE_MEETING_SEND_UPDATES ?? 'all');
  const meetingSendUpdates =
    meetingSendUpdatesRaw === 'externalOnly' || meetingSendUpdatesRaw === 'none'
      ? meetingSendUpdatesRaw
      : 'all';

  return {
    serviceAccountEmail: env.BISPCRM_GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || undefined,
    privateKey: normalizePrivateKey(env.BISPCRM_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    impersonatedUser: env.BISPCRM_GOOGLE_IMPERSONATED_USER?.trim() || undefined,
    timezone: env.BISPCRM_GOOGLE_TIMEZONE?.trim() || 'Europe/Rome',
    syncIntervalMs: Number.isFinite(syncIntervalMs) && syncIntervalMs > 0 ? syncIntervalMs : 300_000,
    defaultCalendarId: env.BISPCRM_GOOGLE_DEFAULT_CALENDAR_ID?.trim() || undefined,
    meetingDefaultDurationMinutes:
      Number.isFinite(meetingDefaultDurationMinutes) && meetingDefaultDurationMinutes > 0
        ? meetingDefaultDurationMinutes
        : 45,
    meetingSendUpdates,
    sheetSources: parseJsonArray<GoogleSheetSourceConfig>(env.BISPCRM_GOOGLE_SHEETS_SOURCES_JSON)
      .filter((source) => source?.spreadsheetId && source?.range)
      .map((source) => ({
        spreadsheetId: String(source.spreadsheetId).trim(),
        range: String(source.range).trim(),
        title: source.title ? String(source.title).trim() : undefined,
        kind: source.kind ?? 'generic',
      })),
    calendarSources: parseJsonArray<GoogleCalendarSourceConfig>(env.BISPCRM_GOOGLE_CALENDAR_SOURCES_JSON)
      .filter((source) => source?.calendarId)
      .map((source) => ({
        calendarId: String(source.calendarId).trim(),
        title: source.title ? String(source.title).trim() : undefined,
        kind: source.kind ?? 'shared',
      })),
  };
}

export class GoogleWorkspaceClient {
  private readonly auth: JWT | null;
  readonly config: GoogleWorkspaceConfig;

  constructor(config: GoogleWorkspaceConfig) {
    this.config = config;
    this.auth =
      config.serviceAccountEmail && config.privateKey
        ? new JWT({
            email: config.serviceAccountEmail,
            key: config.privateKey,
            scopes: [
              'https://www.googleapis.com/auth/spreadsheets.readonly',
              'https://www.googleapis.com/auth/calendar',
            ],
            subject: config.impersonatedUser,
          })
        : null;
  }

  get configured(): boolean {
    return this.auth !== null;
  }

  private async authorizedFetch<T>(url: string, init?: RequestInit): Promise<T> {
    if (!this.auth) {
      throw new Error('Google Workspace client not configured');
    }
    const token = await this.auth.getAccessToken();
    if (!token?.token) {
      throw new Error('Google Workspace access token unavailable');
    }
    const res = await fetch(url, {
      ...init,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token.token}`,
        ...(init?.headers ?? {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) {
      throw new Error(data.error?.message ?? `Google Workspace request failed (${res.status})`);
    }
    return data;
  }

  async fetchSheetSnapshot(source: GoogleSheetSourceConfig): Promise<WorkspaceSheetSnapshot> {
    const encodedRange = encodeURIComponent(source.range);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.spreadsheetId)}/values/${encodedRange}`;
    const data = await this.authorizedFetch<{ values?: string[][] }>(url);
    const sourceKey = buildSourceKey('sheet', source.spreadsheetId, source.range);
    return {
      sourceKey,
      spreadsheetId: source.spreadsheetId,
      range: source.range,
      title: source.title ?? `${source.kind ?? 'generic'} ${source.range}`,
      kind: source.kind ?? 'generic',
      rows: buildSheetRows(data.values ?? []),
    };
  }

  async fetchCalendarSnapshot(source: GoogleCalendarSourceConfig, windowStartIso: string, windowEndIso: string): Promise<WorkspaceCalendarSnapshot> {
    const params = new URLSearchParams({
      timeMin: windowStartIso,
      timeMax: windowEndIso,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      timeZone: this.config.timezone,
    });
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(source.calendarId)}/events?${params.toString()}`;
    const data = await this.authorizedFetch<{ items?: Array<Record<string, unknown>> }>(url);
    const sourceKey = buildSourceKey('calendar', source.calendarId, source.kind ?? 'shared');
    const events = asArray<Record<string, unknown>>(data.items).map((item) => {
      const attendees = asArray<Record<string, unknown>>(item.attendees).map((attendee) => ({
        email: typeof attendee.email === 'string' ? attendee.email : undefined,
        displayName: typeof attendee.displayName === 'string' ? attendee.displayName : undefined,
        responseStatus: typeof attendee.responseStatus === 'string' ? attendee.responseStatus : undefined,
      }));
      const title = typeof item.summary === 'string' && item.summary.trim() ? item.summary.trim() : 'Untitled event';
      const description = typeof item.description === 'string' ? item.description.trim() : undefined;
      const location = typeof item.location === 'string' ? item.location.trim() : undefined;
      const meetingLink =
        typeof item.hangoutLink === 'string'
          ? item.hangoutLink
          : typeof (item.conferenceData as Record<string, unknown> | undefined)?.entryPoints === 'object'
            ? undefined
            : undefined;
      const startAt = toIsoDateTime(item.start);
      const endAt = toIsoDateTime(item.end);
      const searchableText = [title, description ?? '', location ?? '', attendees.map((attendee) => attendee.email ?? attendee.displayName ?? '').join(' ')]
        .join(' ')
        .trim();
      return {
        sourceKey,
        calendarId: source.calendarId,
        eventId: String(item.id ?? `${title}:${startAt ?? ''}`),
        kind: source.kind ?? 'shared',
        title,
        description,
        status: typeof item.status === 'string' ? item.status : undefined,
        location,
        meetingLink,
        startAt,
        endAt,
        attendees,
        searchableText,
        payload: item,
      } satisfies WorkspaceCalendarEvent;
    });

    return {
      sourceKey,
      calendarId: source.calendarId,
      title: source.title ?? source.calendarId,
      kind: source.kind ?? 'shared',
      events,
    };
  }

  async createMeeting(draft: WorkspaceMeetingDraft): Promise<WorkspaceMeetingCreateResult> {
    const calendarId = draft.calendarId ?? this.config.defaultCalendarId ?? this.config.calendarSources[0]?.calendarId;
    if (!calendarId) {
      return { ok: false, error: 'No Google Calendar configured for meeting creation' };
    }
    const sendUpdates = this.config.meetingSendUpdates;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${encodeURIComponent(sendUpdates)}`;
    const body = {
      summary: draft.summary,
      description: draft.description,
      location: draft.location,
      start: {
        dateTime: draft.startAt,
        timeZone: this.config.timezone,
      },
      end: {
        dateTime: draft.endAt,
        timeZone: this.config.timezone,
      },
      attendees: (draft.attendees ?? [])
        .map((email) => email.trim())
        .filter(Boolean)
        .map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: `meet_${Date.now().toString(36)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    try {
      const data = await this.authorizedFetch<Record<string, unknown>>(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const snapshot: WorkspaceCalendarEvent = {
        sourceKey: buildSourceKey('calendar', calendarId, 'meetings'),
        calendarId,
        eventId: String(data.id ?? `event_${Date.now().toString(36)}`),
        kind: 'meetings',
        title: String(data.summary ?? draft.summary),
        description: typeof data.description === 'string' ? data.description : draft.description,
        status: typeof data.status === 'string' ? data.status : undefined,
        location: typeof data.location === 'string' ? data.location : draft.location,
        meetingLink: typeof data.htmlLink === 'string' ? data.htmlLink : undefined,
        startAt: toIsoDateTime(data.start) ?? draft.startAt,
        endAt: toIsoDateTime(data.end) ?? draft.endAt,
        attendees: asArray<Record<string, unknown>>(data.attendees).map((attendee) => ({
          email: typeof attendee.email === 'string' ? attendee.email : undefined,
          displayName: typeof attendee.displayName === 'string' ? attendee.displayName : undefined,
          responseStatus: typeof attendee.responseStatus === 'string' ? attendee.responseStatus : undefined,
        })),
        searchableText: [String(data.summary ?? draft.summary), typeof data.description === 'string' ? data.description : draft.description ?? ''].join(' ').trim(),
        payload: data,
      };
      return {
        ok: true,
        calendarId,
        eventId: snapshot.eventId,
        htmlLink: typeof data.htmlLink === 'string' ? data.htmlLink : undefined,
        event: snapshot,
      };
    } catch (error) {
      return {
        ok: false,
        calendarId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type SettingsCategory = 'models' | 'channels' | 'autoposting' | 'agents' | 'system';

export interface AdminSettingItem {
  key: string;
  value: string | boolean | number | string[] | null;
  type: 'string' | 'boolean' | 'number' | 'secret' | 'string[]';
  source: 'default' | 'eliza-env' | 'runtime';
  category: SettingsCategory;
  description?: string;
}

export interface AdminSettingsState {
  updatedAt: string;
  items: Record<string, AdminSettingItem>;
}

const DEFAULT_RUNTIME_SETTINGS_PATH = '/home/funboy/copilotrm/data/runtime-admin-settings.json';

const SETTING_CATALOG: Array<{
  key: string;
  envKeys: string[];
  category: SettingsCategory;
  type: AdminSettingItem['type'];
  description: string;
  parse?: (raw: string) => AdminSettingItem['value'];
}> = [
  { key: 'models.provider.primary', envKeys: ['OLLAMA_MODEL', 'LARGE_OLLAMA_MODEL'], category: 'models', type: 'string', description: 'Modello primario locale (fallback su large ollama).' },
  { key: 'models.provider.small', envKeys: ['SMALL_OLLAMA_MODEL', 'SMALL_OPENAI_MODEL'], category: 'models', type: 'string', description: 'Modello small per task economici.' },
  { key: 'models.provider.medium', envKeys: ['MEDIUM_OLLAMA_MODEL', 'MEDIUM_OPENAI_MODEL'], category: 'models', type: 'string', description: 'Modello medium per routing e drafting.' },
  { key: 'models.provider.large', envKeys: ['LARGE_OLLAMA_MODEL', 'LARGE_OPENAI_MODEL'], category: 'models', type: 'string', description: 'Modello large per contenuti/decisioni complesse.' },
  { key: 'models.embedding.provider', envKeys: ['OLLAMA_EMBEDDING_MODEL', 'EMBEDDING_OPENAI_MODEL'], category: 'models', type: 'string', description: 'Embedding model per RAG.' },
  { key: 'models.ollama.url', envKeys: ['OLLAMA_SERVER_URL'], category: 'models', type: 'string', description: 'Endpoint Ollama locale.' },
  { key: 'models.openai.enabled', envKeys: ['OPENAI_API_KEY'], category: 'models', type: 'boolean', description: 'Fallback API OpenAI abilitato (chiave presente).', parse: (raw) => Boolean(raw.trim()) },
  { key: 'channels.telegram.botToken', envKeys: ['TELEGRAM_BOT_TOKEN'], category: 'channels', type: 'secret', description: 'Bot token Telegram.' },
  { key: 'channels.telegram.approvedChannels', envKeys: ['TELEGRAM_ID_APPROVE_BOT'], category: 'channels', type: 'string[]', description: 'Canali/gruppi Telegram autorizzati.', parse: (raw) => raw.split(',').map((s) => s.trim()).filter(Boolean) },
  { key: 'channels.telegram.offerChannel', envKeys: ['TELEGRAM_CHANNEL_ID_APPROVE_POST'], category: 'channels', type: 'string', description: 'Canale Telegram offerte.' },
  { key: 'channels.whatsapp.provider', envKeys: ['WHATSAPP_PROVIDER'], category: 'channels', type: 'string', description: 'Provider canale WhatsApp.' },
  { key: 'channels.whatsapp.automationEnabled', envKeys: ['WHATSAPP_AUTOMATION_ENABLED'], category: 'channels', type: 'boolean', description: 'Automazione WhatsApp one-to-one.', parse: parseBool },
  { key: 'channels.email.automationEnabled', envKeys: ['EMAIL_AUTOMATION_ENABLED'], category: 'channels', type: 'boolean', description: 'Automazione email inbound/outbound.', parse: parseBool },
  { key: 'channels.email.outgoingService', envKeys: ['EMAIL_OUTGOING_SERVICE'], category: 'channels', type: 'string', description: 'SMTP/Gmail outbound.' },
  { key: 'channels.email.incomingService', envKeys: ['EMAIL_INCOMING_SERVICE'], category: 'channels', type: 'string', description: 'IMAP inbound.' },
  { key: 'channels.x.enableAutoPosting', envKeys: ['ENABLE_TWITTER_POST_GENERATION'], category: 'autoposting', type: 'boolean', description: 'Auto-post X/Twitter.', parse: parseBool },
  { key: 'channels.x.postIntervalMin', envKeys: ['POST_INTERVAL_MIN'], category: 'autoposting', type: 'number', description: 'Min interval auto-post X.', parse: parseNum },
  { key: 'channels.x.postIntervalMax', envKeys: ['POST_INTERVAL_MAX'], category: 'autoposting', type: 'number', description: 'Max interval auto-post X.', parse: parseNum },
  { key: 'channels.x.approvalEnabled', envKeys: ['TWITTER_APPROVAL_ENABLED'], category: 'autoposting', type: 'boolean', description: 'Approval pre-post X.', parse: parseBool },
  { key: 'channels.instagram.postIntervalMin', envKeys: ['INSTAGRAM_POST_INTERVAL_MIN'], category: 'autoposting', type: 'number', description: 'Min interval auto-post Instagram.', parse: parseNum },
  { key: 'channels.instagram.postIntervalMax', envKeys: ['INSTAGRAM_POST_INTERVAL_MAX'], category: 'autoposting', type: 'number', description: 'Max interval auto-post Instagram.', parse: parseNum },
  { key: 'agents.assistance.enabled', envKeys: [], category: 'agents', type: 'boolean', description: 'Abilita agent assistenza.', parse: () => true },
  { key: 'agents.preventivi.enabled', envKeys: [], category: 'agents', type: 'boolean', description: 'Abilita agent preventivi.', parse: () => true },
  { key: 'agents.telephony.enabled', envKeys: [], category: 'agents', type: 'boolean', description: 'Abilita agent telephony/connectivity.', parse: () => true },
  { key: 'agents.customerCare.enabled', envKeys: [], category: 'agents', type: 'boolean', description: 'Abilita agent customer care.', parse: () => true },
  { key: 'agents.content.enabled', envKeys: [], category: 'agents', type: 'boolean', description: 'Abilita content factory.', parse: () => true },
  { key: 'agents.compliance.enabled', envKeys: [], category: 'agents', type: 'boolean', description: 'Abilita compliance guardrails.', parse: () => true },
  { key: 'agents.energy.enabled', envKeys: [], category: 'agents', type: 'boolean', description: 'Abilita agent energia.', parse: () => true },
  { key: 'agents.hardware.enabled', envKeys: [], category: 'agents', type: 'boolean', description: 'Abilita agent hardware/software.', parse: () => true },
  { key: 'system.defaultApprovalMode', envKeys: [], category: 'system', type: 'string', description: 'Default approval mode (manual/auto-safe).', parse: () => 'manual' },
  { key: 'system.maxSocialPostsPerDay', envKeys: [], category: 'system', type: 'number', description: 'Limite post social/day complessivo.', parse: () => 10 },
];

function parseBool(raw: string): boolean {
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function parseNum(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    const value = rawValue.split(' #')[0].trim();
    out[key] = value;
  }
  return out;
}

function firstEnvValue(env: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = env[key];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function inferDefaultValue(item: typeof SETTING_CATALOG[number]): AdminSettingItem['value'] {
  if (!item.parse) return null;
  try {
    return item.parse('');
  } catch {
    return null;
  }
}

export function maskSettingValue(setting: AdminSettingItem): AdminSettingItem['value'] {
  if (setting.type !== 'secret') return setting.value;
  const raw = typeof setting.value === 'string' ? setting.value : '';
  if (!raw) return null;
  if (raw.length <= 8) return '********';
  return `${raw.slice(0, 4)}********${raw.slice(-4)}`;
}

export class AdminSettingsRepository {
  private state: AdminSettingsState;

  constructor(opts?: { elizaEnvPath?: string; runtimeSettingsPath?: string }) {
    const elizaEnvPath = opts?.elizaEnvPath ?? '/home/funboy/eliza/.env';
    const runtimePath = opts?.runtimeSettingsPath ?? DEFAULT_RUNTIME_SETTINGS_PATH;
    this.state = this.bootstrap(elizaEnvPath, runtimePath);
  }

  private bootstrap(elizaEnvPath: string, runtimePath: string): AdminSettingsState {
    const items: Record<string, AdminSettingItem> = {};

    // Fonte primaria: process.env (caricato da dev-env.sh con /home/funboy/copilotrm/.env)
    // Fonte secondaria: file .env di Eliza — solo per chiavi non presenti in process.env
    // IMPORTANTE: process.env vince sempre per evitare di usare token/segreti di Eliza al posto di quelli CopilotRM
    const processEnvClean = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
    );
    const elizaEnv = existsSync(elizaEnvPath) ? parseDotEnv(readFileSync(elizaEnvPath, 'utf8')) : {};
    const merged = { ...elizaEnv, ...processEnvClean }; // process.env sovrascrive eliza

    for (const c of SETTING_CATALOG) {
      const raw = firstEnvValue(merged, c.envKeys);
      const value = raw !== undefined ? (c.parse ? c.parse(raw) : raw) : inferDefaultValue(c);
      items[c.key] = {
        key: c.key,
        value,
        type: c.type,
        source: raw !== undefined ? 'eliza-env' : 'default',
        category: c.category,
        description: c.description,
      };
    }

    if (existsSync(runtimePath)) {
      try {
        const runtimeData = JSON.parse(readFileSync(runtimePath, 'utf8')) as AdminSettingsState;
        for (const [k, v] of Object.entries(runtimeData.items ?? {})) {
          if (items[k]) items[k] = { ...items[k], ...v, source: 'runtime' };
          else items[k] = { ...v, source: 'runtime' };
        }
      } catch {
        // ignore malformed runtime settings file
      }
    }

    return { updatedAt: new Date().toISOString(), items };
  }

  list(opts?: { masked?: boolean; category?: SettingsCategory }): AdminSettingItem[] {
    return Object.values(this.state.items)
      .filter((i) => (opts?.category ? i.category === opts.category : true))
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((i) => ({ ...i, value: opts?.masked === false ? i.value : maskSettingValue(i) }));
  }

  get(key: string, opts?: { masked?: boolean }): AdminSettingItem | undefined {
    const item = this.state.items[key];
    if (!item) return undefined;
    return { ...item, value: opts?.masked === false ? item.value : maskSettingValue(item) };
  }

  upsert(key: string, value: AdminSettingItem['value']): AdminSettingItem {
    const existing = this.state.items[key];
    const next: AdminSettingItem = existing
      ? { ...existing, value, source: 'runtime' }
      : { key, value, type: Array.isArray(value) ? 'string[]' : typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string', source: 'runtime', category: 'system' };
    this.state.items[key] = next;
    this.state.updatedAt = new Date().toISOString();
    return next;
  }

  importItem(item: AdminSettingItem): AdminSettingItem {
    this.state.items[item.key] = { ...item };
    this.state.updatedAt = new Date().toISOString();
    return this.state.items[item.key];
  }

  replaceAll(items: AdminSettingItem[]): void {
    this.state.items = Object.fromEntries(items.map((i) => [i.key, { ...i }]));
    this.state.updatedAt = new Date().toISOString();
  }

  persist(filePath = DEFAULT_RUNTIME_SETTINGS_PATH): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(this.state, null, 2));
  }

  snapshot(opts?: { masked?: boolean }): AdminSettingsState {
    const items = Object.fromEntries(this.list({ masked: opts?.masked }).map((i) => [i.key, i]));
    return { updatedAt: this.state.updatedAt, items };
  }
}

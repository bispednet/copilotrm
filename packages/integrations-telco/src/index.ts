/**
 * integrations-telco — Ingest offerte telefonia fissa/mobile per il mercato italiano.
 *
 * Fonti supportate:
 *   - AGCOM Confronta Offerte (comparatore istituzionale)
 *   - TIM, Fastweb, Vodafone, WindTre, Iliad (pagine trasparenza + offerte)
 *
 * Per operatori con pagine HTML: i parser sono stub in attesa di implementazione.
 * Le URL di trasparenza tariffaria sono obbligatorie per legge (delibera AGCOM).
 *
 * Registry fonti: /data/sources-registry.json
 */

// ── Tipi ─────────────────────────────────────────────────────────────────────

export type TelcoServiceType = 'mobile' | 'fixed' | 'convergent' | 'business';

export interface TelcoOffer {
  id: string;
  source: string;            // es. 'tim', 'iliad'
  operator: string;
  offerName: string;
  serviceType: TelcoServiceType;
  monthlyPriceEur?: number;
  activationFeeEur?: number;
  dataGb?: number;           // null/undefined = illimitato se minutesUnlimited=true
  dataUnlimited?: boolean;
  minutesUnlimited?: boolean;
  smsUnlimited?: boolean;
  speedMbps?: number;        // per offerte fibra/FWA
  contractDurationMonths?: number;
  eligibility?: string;      // es. 'solo portabilità da operatore virtuale'
  promoUntil?: string;
  url?: string;
  fetchedAt: string;
}

export interface TelcoIngestResult {
  source: string;
  operator: string;
  configured: boolean;
  offers: TelcoOffer[];
  transparencyUrl?: string;
  fetchedAt: string;
  error?: string;
  durationMs?: number;
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&euro;|&#8364;/gi, '€');
}

function parseEuroAmount(raw: string): number | undefined {
  const m = raw.match(/(\d{1,4}(?:[.,]\d{1,2})?)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function inferServiceType(text: string): TelcoServiceType {
  const t = text.toLowerCase();
  if (/(fibra|adsl|fwa|ftth|fttc|casa)/i.test(t)) return 'fixed';
  if (/(mobile|sim|gb|giga|5g|4g)/i.test(t)) return 'mobile';
  if (/(fisso\s*\+\s*mobile|converg|bundle)/i.test(t)) return 'convergent';
  if (/(business|azienda|p\.?\s*iva)/i.test(t)) return 'business';
  return 'mobile';
}

function extractHeadingCandidates(html: string): Array<{ title: string; index: number }> {
  const out: Array<{ title: string; index: number }> = [];
  const regex = /<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const title = normalizeSpaces(stripHtml(match[2] ?? ''));
    if (title.length < 6 || title.length > 120) continue;
    if (!/[a-zA-Z]/.test(title)) continue;
    out.push({ title, index: match.index });
    if (out.length >= 25) break;
  }
  return out;
}

async function fetchOperatorOffers(op: typeof OPERATORS[number], timeoutMs = 12000): Promise<TelcoIngestResult> {
  const startedAt = Date.now();
  const url = op.offersUrl ?? op.transparencyMobile ?? op.transparencyFixed;
  const base: TelcoIngestResult = {
    source: op.id,
    operator: op.name,
    configured: Boolean(url),
    offers: [],
    transparencyUrl: op.transparencyMobile ?? op.transparencyFixed ?? op.offersUrl,
    fetchedAt: new Date().toISOString(),
  };
  if (!url) return { ...base, configured: false, error: 'Nessuna URL configurata' };

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'CopilotRM/1.0 Telco Ingest', Accept: 'text/html,application/xhtml+xml,*/*' },
    });
    if (!res.ok) {
      return { ...base, configured: false, error: `HTTP ${res.status} su ${url}`, durationMs: Date.now() - startedAt };
    }

    const html = await res.text();
    const candidates = extractHeadingCandidates(html);
    const dedupe = new Set<string>();
    const offers: TelcoOffer[] = [];

    for (const c of candidates) {
      const key = c.title.toLowerCase();
      if (dedupe.has(key)) continue;
      dedupe.add(key);

      const context = html.slice(c.index, Math.min(html.length, c.index + 700));
      const textContext = normalizeSpaces(stripHtml(context));
      const priceMatch = textContext.match(/(?:€\s?\d{1,4}(?:[.,]\d{1,2})?|\d{1,4}(?:[.,]\d{1,2})?\s?€)/);

      offers.push({
        id: `${op.id}-${key.replace(/[^a-z0-9]+/g, '-').slice(0, 56)}`,
        source: op.id,
        operator: op.name,
        offerName: c.title,
        serviceType: inferServiceType(`${c.title} ${textContext}`),
        monthlyPriceEur: priceMatch ? parseEuroAmount(priceMatch[0]) : undefined,
        dataUnlimited: /\billimitat[oi]\b/i.test(textContext) ? true : undefined,
        minutesUnlimited: /\bminut[io].*illimitat|chiamate.*illimitat/i.test(textContext) ? true : undefined,
        smsUnlimited: /\bsms.*illimitat/i.test(textContext) ? true : undefined,
        speedMbps: (() => {
          const m = textContext.match(/(\d{2,5})\s*(?:mbps|mb\/s|mega)/i);
          const n = m ? Number(m[1]) : NaN;
          return Number.isFinite(n) ? n : undefined;
        })(),
        url,
        fetchedAt: new Date().toISOString(),
      });
      if (offers.length >= 10) break;
    }

    return {
      ...base,
      configured: offers.length > 0,
      offers,
      error: offers.length ? undefined : `Pagina letta ma nessuna offerta estratta da ${url}`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ...base,
      configured: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

function pseudoOperatorFromUrl(url: string): { id: string; name: string; offersUrl: string } {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'custom-source';
    }
  })();
  const slug = host.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return { id: `ext-${slug}`.slice(0, 48), name: host.toUpperCase(), offersUrl: url };
}

// ── Operatori: configurazione ────────────────────────────────────────────────

const OPERATORS: Array<{
  id: string;
  name: string;
  marketShareBroadbandPct?: number;
  transparencyMobile?: string;
  transparencyFixed?: string;
  offersUrl?: string;
}> = [
  {
    id: 'tim',
    name: 'TIM',
    marketShareBroadbandPct: 33.5,
    transparencyMobile: 'https://www.tim.it/assistenza/trasparenza-tariffaria/trasparenza-tariffaria-delle-offerte-di-linea-mobile-piani-base',
    transparencyFixed: 'https://www.tim.it/assistenza/trasparenza-tariffaria/trasparenza-tariffaria-delle-offerte-di-linea-fissa-voce',
    offersUrl: 'https://www.tim.it/offerte',
  },
  {
    id: 'fastweb',
    name: 'Fastweb',
    marketShareBroadbandPct: 15.1,
    offersUrl: 'https://www.fastweb.it/adsl-fibra-ottica/offerta-fisso-mobile/',
    transparencyFixed: 'https://www.fastweb.it/',
  },
  {
    id: 'vodafone',
    name: 'Vodafone',
    marketShareBroadbandPct: 15.1,
    offersUrl: 'https://privati.vodafone.it/casa/fibra',
    transparencyFixed: 'https://privati.vodafone.it/casa/fibra',
  },
  {
    id: 'windtre',
    name: 'WindTre',
    marketShareBroadbandPct: 14.4,
    offersUrl: 'https://www.windtre.it/all-inclusive',
    transparencyFixed: 'https://www.windtre.it/trasparenza-tariffaria/',
  },
  {
    id: 'iliad',
    name: 'Iliad',
    offersUrl: 'https://www.iliad.it/',
    transparencyMobile: 'https://www.iliad.it/trasparenza-tariffaria-mobile.html',
    transparencyFixed: 'https://www.iliad.it/trasparenza-tariffaria-fibra.html',
  },
];

// ── AGCOM Comparatore ─────────────────────────────────────────────────────────
// URL: https://confrontaofferte.agcom.it/
// Non espone una REST API pubblica documentata.
// Strategia: accesso manuale o integrazione HTML quando endpoint sarà stabile.

export function agcomComparatorUrl(serviceType: TelcoServiceType = 'mobile'): string {
  return `https://confrontaofferte.agcom.it/?tipo=${serviceType}`;
}

// ── Stub generici per operatori ───────────────────────────────────────────────

/**
 * Restituisce stub per tutti gli operatori telco.
 * configured=false → URL di trasparenza disponibile.
 * Per implementare il parsing: aggiungere fetchOperatorPage(url) + parser dedicato.
 */
export function getOperatorStubs(): TelcoIngestResult[] {
  return OPERATORS.map((op) => ({
    source: op.id,
    operator: op.name,
    configured: false,
    offers: [],
    transparencyUrl: op.transparencyMobile ?? op.transparencyFixed ?? op.offersUrl,
    fetchedAt: new Date().toISOString(),
    error: `Parser non implementato — accesso manuale: ${op.offersUrl ?? op.transparencyMobile ?? ''}`,
  }));
}

// ── TelcoIngestService ────────────────────────────────────────────────────────

export class TelcoIngestService {
  /** Parsing reale delle pagine offerte operatori (best effort, no credenziali). */
  async fetchAll(opts?: { timeoutMs?: number; extraUrls?: string[] }): Promise<TelcoIngestResult[]> {
    const timeoutMs = opts?.timeoutMs ?? 12_000;
    const core = await Promise.all(OPERATORS.map((op) => fetchOperatorOffers(op, timeoutMs)));
    const extra = (opts?.extraUrls ?? [])
      .map((u) => u.trim())
      .filter(Boolean)
      .map((u) => pseudoOperatorFromUrl(u));
    if (!extra.length) return core;
    const extResults = await Promise.all(extra.map((op) => fetchOperatorOffers(op, timeoutMs)));
    return [...core, ...extResults];
  }

  /** Lista URL trasparenza per tutti gli operatori */
  operatorTransparencyUrls(): Array<{ operator: string; url: string }> {
    return OPERATORS.map((op) => ({
      operator: op.name,
      url: op.transparencyMobile ?? op.transparencyFixed ?? op.offersUrl ?? '',
    }));
  }

  /** AGCOM comparatore URL per tipo servizio */
  agcomUrl(serviceType: TelcoServiceType = 'mobile'): string {
    return agcomComparatorUrl(serviceType);
  }
}

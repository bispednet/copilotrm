/**
 * integrations-energy — Ingest offerte energia per il mercato italiano.
 *
 * Fonti supportate:
 *   - Portale Offerte ARERA (open data CSV/XML, nessuna auth)
 *   - Enel, Iren, Enegan, TIM Energia, Fastweb Energia, WindTre Energia,
 *     Edison, Estra, Duferco, A2A (stub HTML — in attesa di API dedicate)
 *
 * Registry fonti: /data/sources-registry.json
 */

// ── Tipi ─────────────────────────────────────────────────────────────────────

export type Commodity = 'electricity' | 'gas' | 'dual';
export type OfferType = 'PLACET' | 'MLIBERO' | 'other';
export type CustomerSegment = 'residential' | 'business';

export interface EnergyOffer {
  id: string;
  source: string;         // es. 'arera-portale-offerte', 'enel'
  operator: string;       // es. 'Enel', 'Edison'
  offerCode?: string;
  offerName: string;
  commodity: Commodity;
  type: OfferType;
  segment: CustomerSegment;
  fixedFeeEur?: number;      // quota fissa mensile in EUR
  variablePriceFormula?: string; // es. 'PUN + 0.02 €/kWh'
  variablePriceCent?: number;    // centesimi EUR per kWh o Smc se prezzo fisso
  region?: string;
  validFrom?: string;
  validTo?: string;
  url?: string;
  fetchedAt: string;
  raw?: Record<string, unknown>;
}

export interface EnergyIngestResult {
  source: string;
  configured: boolean;
  offers: EnergyOffer[];
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

// ── Portale Offerte ARERA — open data CSV/XML ─────────────────────────────────
// Docs: https://www.ilportaleofferte.it/portaleOfferte/it/open-data.page
// Formato file: aggiornato mensilmente — il path contiene anno/mese e data
// Aggiorna BASE_DATE per ogni ingest periodico oppure calcola dinamicamente

const ARERA_BASE = 'https://www.ilportaleofferte.it/portaleOfferte/resources/opendata';

function arMonthTag(): string {
  const now = new Date();
  return `${now.getFullYear()}_${now.getMonth() + 1}`;
}

function arDateTag(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Costruisce URL open data ARERA basato su data corrente */
export function araeraOpenDataUrl(
  commodity: 'E' | 'G' | 'D',
  type: 'PLACET' | 'MLIBERO',
  format: 'csv' | 'xml' = 'csv'
): string {
  const mt = arMonthTag();
  const dt = arDateTag();
  if (type === 'PLACET') {
    return `${ARERA_BASE}/csv/offerte/${mt}/PO_Offerte_${commodity}_PLACET_${dt}.csv`;
  }
  const ext = format === 'xml' ? 'xml' : 'csv';
  return `${ARERA_BASE}/csv/offerteML/${mt}/PO_Offerte_${commodity}_MLIBERO_${dt}.${ext}`;
}

function areraOpenDataUrlForDate(date: Date, commodity: 'E' | 'G', type: 'PLACET' | 'MLIBERO', format: 'csv' | 'xml' = 'csv'): string {
  const mt = `${date.getFullYear()}_${date.getMonth() + 1}`;
  const dt = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  if (type === 'PLACET') {
    return `${ARERA_BASE}/csv/offerte/${mt}/PO_Offerte_${commodity}_PLACET_${dt}.csv`;
  }
  const ext = format === 'xml' ? 'xml' : 'csv';
  return `${ARERA_BASE}/csv/offerteML/${mt}/PO_Offerte_${commodity}_MLIBERO_${dt}.${ext}`;
}

async function resolveAreraCsvUrl(commodity: 'E' | 'G', opts?: { timeout?: number; lookbackDays?: number }): Promise<string> {
  const timeout = opts?.timeout ?? 7000;
  const lookbackDays = Math.max(1, Math.min(opts?.lookbackDays ?? 45, 120));
  const now = new Date();
  for (let i = 0; i < lookbackDays; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const candidate = areraOpenDataUrlForDate(d, commodity, 'PLACET', 'csv');
    try {
      const res = await fetch(candidate, { method: 'HEAD', signal: AbortSignal.timeout(timeout) });
      if (res.ok || res.status === 405) return candidate;
    } catch {
      // continue lookback
    }
  }
  return araeraOpenDataUrl(commodity, 'PLACET', 'csv');
}

/** Parsa una riga CSV ARERA PLACET minimale (header ignorato — adattare ai campi reali) */
function parsePlacetCsvRow(row: string, commodity: Commodity): EnergyOffer | null {
  const cols = row.split(';');
  if (cols.length < 5) return null;
  return {
    id: `arera-${commodity}-${cols[0]?.trim()}`,
    source: 'arera-portale-offerte',
    operator: cols[1]?.trim() ?? 'N/D',
    offerCode: cols[0]?.trim(),
    offerName: cols[2]?.trim() ?? '',
    commodity,
    type: 'PLACET',
    segment: 'residential',
    fixedFeeEur: cols[3] ? parseFloat(cols[3].replace(',', '.')) : undefined,
    variablePriceCent: cols[4] ? parseFloat(cols[4].replace(',', '.')) : undefined,
    url: 'https://www.ilportaleofferte.it/',
    fetchedAt: new Date().toISOString(),
    raw: { cols },
  };
}

/**
 * Scarica e parsa i CSV PLACET dal Portale Offerte ARERA.
 * Nessuna autenticazione richiesta (open data).
 */
export async function fetchAreraPlacet(
  commodity: Commodity,
  opts?: { timeout?: number }
): Promise<EnergyIngestResult> {
  const t0 = Date.now();
  const base: EnergyIngestResult = {
    source: 'arera-portale-offerte',
    configured: true, // sempre disponibile, open data
    offers: [],
    fetchedAt: new Date().toISOString(),
  };

  const commKey = commodity === 'electricity' ? 'E' : commodity === 'gas' ? 'G' : null;
  if (!commKey) return { ...base, error: 'Dual fuel PLACET non disponibile — usa fetchAreraMlibero' };

  const url = await resolveAreraCsvUrl(commKey, { timeout: Math.min(opts?.timeout ?? 20_000, 7000) });

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(opts?.timeout ?? 20_000) });
    if (!res.ok) {
      return { ...base, error: `ARERA CSV HTTP ${res.status} — verifica URL: ${url}`, durationMs: Date.now() - t0 };
    }
    const text = await res.text();
    const lines = text.split('\n').slice(1); // salta header
    const offers: EnergyOffer[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const offer = parsePlacetCsvRow(line, commodity);
      if (offer) offers.push(offer);
    }
    return { ...base, offers, durationMs: Date.now() - t0 };
  } catch (e) {
    return { ...base, error: String(e), durationMs: Date.now() - t0 };
  }
}

// ── Stub generici per operatori IT ───────────────────────────────────────────
// Ogni stub espone configured=false finché l'integrazione HTML/API non è implementata.
// URL di trasparenza tariffaria derivati dal registro fonti.

const OPERATOR_STUBS: Array<{
  id: string;
  name: string;
  commodity: Commodity[];
  transparencyUrl: string;
}> = [
  { id: 'enel', name: 'Enel Energia', commodity: ['electricity', 'gas'], transparencyUrl: 'https://www.enelenergia.it/it/privati/elettricita-e-gas/' },
  { id: 'iren', name: 'Iren Mercato', commodity: ['electricity', 'gas'], transparencyUrl: 'https://www.irenmercato.it/offerte/' },
  { id: 'enegan', name: 'Enegan', commodity: ['electricity', 'gas'], transparencyUrl: 'https://www.enegan.it/offerte/' },
  { id: 'tim-energia', name: 'TIM Energia (PostePay)', commodity: ['electricity', 'gas'], transparencyUrl: 'https://www.tim.it/luce-gas' },
  { id: 'fastweb-energia', name: 'Fastweb Energia', commodity: ['electricity', 'gas'], transparencyUrl: 'https://www.fastweb.it/adsl-fibra-ottica/casa-mobile-energia/' },
  { id: 'wind3-energia', name: 'WindTre Energia', commodity: ['electricity', 'gas'], transparencyUrl: 'https://www.windtre.it/luce-gas/' },
  { id: 'edison', name: 'Edison Energia', commodity: ['electricity', 'gas'], transparencyUrl: 'https://www.edisonenergia.it/offerte/' },
  { id: 'estra', name: 'Estra Energie', commodity: ['electricity', 'gas'], transparencyUrl: 'https://www.estraenergie.it/' },
  { id: 'duferco', name: 'Duferco Energia', commodity: ['electricity', 'gas'], transparencyUrl: 'https://www.dufercoenergia.com/' },
  { id: 'a2a', name: 'A2A Energia', commodity: ['electricity', 'gas'], transparencyUrl: 'https://www.a2aenergia.eu/' },
];

/**
 * Restituisce stub ingest per tutti gli operatori non-ARERA.
 * configured=false → URL di trasparenza disponibile per accesso manuale.
 * Per implementare il parsing HTML: aggiungere fetchOperatorHtml(url) + parser dedicato.
 */
export function getOperatorStubs(): EnergyIngestResult[] {
  return OPERATOR_STUBS.map((op) => ({
    source: op.id,
    configured: false,
    offers: [],
    fetchedAt: new Date().toISOString(),
    error: `Parser HTML non implementato — accesso manuale: ${op.transparencyUrl}`,
  }));
}

async function fetchOperatorHtmlOffers(
  op: typeof OPERATOR_STUBS[number],
  opts?: { timeout?: number }
): Promise<EnergyIngestResult> {
  const t0 = Date.now();
  const base: EnergyIngestResult = {
    source: op.id,
    configured: true,
    offers: [],
    fetchedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(op.transparencyUrl, {
      signal: AbortSignal.timeout(opts?.timeout ?? 12_000),
      headers: { 'User-Agent': 'CopilotRM/1.0 Energy Ingest', Accept: 'text/html,application/xhtml+xml,*/*' },
    });
    if (!res.ok) {
      return { ...base, configured: false, error: `HTTP ${res.status} su ${op.transparencyUrl}`, durationMs: Date.now() - t0 };
    }
    const html = await res.text();
    const headingRegex = /<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
    const dedupe = new Set<string>();
    const offers: EnergyOffer[] = [];
    let match: RegExpExecArray | null;

    while ((match = headingRegex.exec(html)) !== null) {
      const heading = normalizeSpaces(stripHtml(match[2] ?? ''));
      if (heading.length < 6 || heading.length > 120) continue;
      if (!/[a-zA-Z]/.test(heading)) continue;

      const key = heading.toLowerCase();
      if (dedupe.has(key)) continue;
      dedupe.add(key);

      const context = html.slice(match.index, Math.min(html.length, match.index + 700));
      const textContext = normalizeSpaces(stripHtml(context));
      const priceMatch = textContext.match(/(?:€\s?\d{1,4}(?:[.,]\d{1,2})?|\d{1,4}(?:[.,]\d{1,2})?\s?€)/);
      const commodity: Commodity = /\bgas\b/i.test(`${heading} ${textContext}`)
        ? 'gas'
        : /\bdual|luce\s*\+\s*gas\b/i.test(`${heading} ${textContext}`)
          ? 'dual'
          : 'electricity';

      offers.push({
        id: `${op.id}-${key.replace(/[^a-z0-9]+/g, '-').slice(0, 56)}`,
        source: op.id,
        operator: op.name,
        offerName: heading,
        commodity,
        type: 'other',
        segment: /(business|azienda|p\.?\s*iva)/i.test(textContext) ? 'business' : 'residential',
        fixedFeeEur: priceMatch ? parseEuroAmount(priceMatch[0]) : undefined,
        url: op.transparencyUrl,
        fetchedAt: new Date().toISOString(),
      });
      if (offers.length >= 8) break;
    }

    return {
      ...base,
      configured: offers.length > 0,
      offers,
      error: offers.length ? undefined : `Pagina letta ma nessuna offerta estratta da ${op.transparencyUrl}`,
      durationMs: Date.now() - t0,
    };
  } catch (error) {
    return {
      ...base,
      configured: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - t0,
    };
  }
}

function pseudoOperatorFromUrl(url: string): typeof OPERATOR_STUBS[number] {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'custom-source';
    }
  })();
  const slug = host.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    id: `ext-${slug}`.slice(0, 48),
    name: host.toUpperCase(),
    commodity: ['electricity', 'gas', 'dual'],
    transparencyUrl: url,
  };
}

// ── EnergyIngestService ───────────────────────────────────────────────────────

/**
 * Esegue ingest completo: ARERA (open data reale) + stub operatori.
 * Da chiamare periodicamente (es. ogni settimana) via worker o endpoint admin.
 */
export class EnergyIngestService {
  async fetchAll(opts?: { timeout?: number; extraUrls?: string[] }): Promise<EnergyIngestResult[]> {
    const [elec, gas] = await Promise.all([
      fetchAreraPlacet('electricity', opts),
      fetchAreraPlacet('gas', opts),
    ]);
    const extraOperators = (opts?.extraUrls ?? [])
      .map((u) => u.trim())
      .filter(Boolean)
      .map((u) => pseudoOperatorFromUrl(u));
    const operatorResults = await Promise.all([...OPERATOR_STUBS, ...extraOperators].map((op) => fetchOperatorHtmlOffers(op, opts)));
    return [elec, gas, ...operatorResults];
  }

  /** Restituisce solo le offerte ARERA (open data, sempre disponibili) */
  async fetchArera(): Promise<EnergyIngestResult[]> {
    return Promise.all([
      fetchAreraPlacet('electricity'),
      fetchAreraPlacet('gas'),
    ]);
  }

  /** Lista URL trasparenza per tutti gli operatori */
  operatorTransparencyUrls(): Array<{ operator: string; url: string }> {
    return OPERATOR_STUBS.map((op) => ({ operator: op.name, url: op.transparencyUrl }));
  }
}

import { Agent, request as httpsRequest } from 'node:https';

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

export interface TelcoCoverageCandidate {
  addressId: string;
  fullAddress: string;
  city: string;
  street: string;
  score: number;
}

export interface TelcoCoverageLookup {
  provider: 'italia-bul';
  query: string;
  normalizedAddress: string;
  matchedRegion: string;
  matchedCity: string;
  matchedRegionId: number;
  matchedCityId: number;
  officialSearchUrl: string;
  fixedLineHint?: string;
  candidates: TelcoCoverageCandidate[];
  note?: string;
  fetchedAt: string;
}

interface BulRegion {
  region_id: number;
  region_name: string;
}

interface BulCity {
  city_id: number;
  city_name: string;
  region_id?: number;
  region_name?: string;
}

interface BulAddressCandidate {
  id_egon: number | string;
  comune: string;
  nome_strada: string;
  indirizzo_compl: string;
  score: number;
}

interface IndexedBulCity {
  regionId: number;
  regionName: string;
  cityId: number;
  cityName: string;
  normalized: string;
}

const BUL_BASE_URL = 'https://bandaultralarga.italia.it';
const BUL_INSECURE_AGENT = new Agent({ rejectUnauthorized: false });
const BUL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let bulRegionsCache: { expiresAt: number; value: BulRegion[] } | null = null;
let bulRegionsPending: Promise<BulRegion[]> | null = null;
let bulCitiesCache: { expiresAt: number; value: IndexedBulCity[] } | null = null;
let bulCitiesPending: Promise<IndexedBulCity[]> | null = null;

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeLookup(value: string): string {
  return normalizeSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase();
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

function extractLikelyLandline(value: string): string | undefined {
  const match = value.match(/(?:\+39\s*)?(0\d(?:[\d\s-]{5,}\d))/);
  const digits = match?.[1]?.replace(/[^\d]/g, '');
  return digits && digits.length >= 8 ? digits : undefined;
}

function extractStreetQuery(raw: string, cityName: string, regionName: string): string {
  let candidate = normalizeSpaces(raw);
  const normalizedCity = normalizeLookup(cityName);
  const normalizedRegion = normalizeLookup(regionName);
  const chunks = candidate.split(/[,;|\n]/).map((part) => normalizeSpaces(part)).filter(Boolean);
  const addressLead = chunks.find((chunk) => /\b(via|viale|piazza|corso|largo|vicolo|strada|contrada|piazzale|localita|località|traversa)\b/i.test(chunk));
  candidate = addressLead ?? candidate;
  const noisePatterns = [
    /\b(verifica|copertura|fibra|ftth|fttc|adsl|fwa|telefonia|connettivita|connettività|router|commerciale|cliente|numero fisso|telefono|cellulare|whatsapp|ticket)\b/gi,
    /\b(indirizzo|address|civico|cap)\b/gi,
  ];
  noisePatterns.forEach((pattern) => {
    candidate = candidate.replace(pattern, ' ');
  });
  candidate = normalizeSpaces(candidate);

  const normalizedCandidate = normalizeLookup(candidate);
  if (normalizedCandidate.includes(normalizedCity)) {
    const cityRegex = new RegExp(`\\b${cityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig');
    candidate = normalizeSpaces(candidate.replace(cityRegex, ' '));
  }
  if (normalizedCandidate.includes(normalizedRegion)) {
    const regionRegex = new RegExp(`\\b${regionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig');
    candidate = normalizeSpaces(candidate.replace(regionRegex, ' '));
  }
  candidate = candidate.replace(/\b[A-Z]{2}\b/g, ' ');
  candidate = candidate.replace(/\s+/g, ' ').trim();
  return candidate;
}

function bestMatchingCity(raw: string, cities: IndexedBulCity[]): IndexedBulCity | null {
  const normalized = normalizeLookup(raw);
  const matches = cities.filter((city) => normalized.includes(city.normalized));
  if (!matches.length) return null;
  matches.sort((a, b) => b.normalized.length - a.normalized.length);
  return matches[0] ?? null;
}

async function fetchBulJson<T>(url: string, timeoutMs = 10_000): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const req = httpsRequest(url, {
      method: 'GET',
      agent: BUL_INSECURE_AGENT,
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'CopilotRM/1.0 Telco Coverage',
        Accept: 'application/json,text/plain,*/*',
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(`BUL HTTP ${res.statusCode}: ${body.slice(0, 180)}`));
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('BUL timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function loadBulRegions(): Promise<BulRegion[]> {
  if (bulRegionsCache && bulRegionsCache.expiresAt > Date.now()) return bulRegionsCache.value;
  if (bulRegionsPending) return bulRegionsPending;
  bulRegionsPending = (async () => {
    const regions = await fetchBulJson<BulRegion[]>(`${BUL_BASE_URL}/wp-json/bul/v1/regions`);
    bulRegionsCache = { value: regions, expiresAt: Date.now() + BUL_CACHE_TTL_MS };
    bulRegionsPending = null;
    return regions;
  })().catch((error) => {
    bulRegionsPending = null;
    throw error;
  });
  return bulRegionsPending;
}

async function loadBulCities(): Promise<IndexedBulCity[]> {
  if (bulCitiesCache && bulCitiesCache.expiresAt > Date.now()) return bulCitiesCache.value;
  if (bulCitiesPending) return bulCitiesPending;
  bulCitiesPending = (async () => {
    const regions = await loadBulRegions();
    const cityLists = await Promise.all(regions.map(async (region) => {
      const cities = await fetchBulJson<BulCity[]>(`${BUL_BASE_URL}/wp-json/bul/v1/region/${region.region_id}/cities`);
      return cities.map((city) => ({
        regionId: region.region_id,
        regionName: region.region_name,
        cityId: city.city_id,
        cityName: city.city_name,
        normalized: normalizeLookup(city.city_name),
      }));
    }));
    const indexed = cityLists.flat();
    bulCitiesCache = { value: indexed, expiresAt: Date.now() + BUL_CACHE_TTL_MS };
    bulCitiesPending = null;
    return indexed;
  })().catch((error) => {
    bulCitiesPending = null;
    throw error;
  });
  return bulCitiesPending;
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

  /** Lookup ufficiale best-effort sul portale BUL, basato su indirizzo presente nel testo. */
  async lookupCoverageByAddress(rawAddress: string): Promise<TelcoCoverageLookup | null> {
    const query = normalizeSpaces(rawAddress);
    if (!query || query.length < 6) return null;

    const cities = await loadBulCities();
    const city = bestMatchingCity(query, cities);
    if (!city) return null;

    const streetQuery = extractStreetQuery(query, city.cityName, city.regionName);
    if (!streetQuery || streetQuery.length < 4) return null;

    const params = new URLSearchParams({
      region: city.regionName,
      city: String(city.cityId),
      address: streetQuery,
    });
    const searchUrl = `${BUL_BASE_URL}/wp-json/bul/v1/address-search?${params.toString()}`;
    const results = await fetchBulJson<BulAddressCandidate[]>(searchUrl);
    const candidates = (results ?? []).slice(0, 5).map((candidate) => ({
      addressId: String(candidate.id_egon),
      fullAddress: candidate.indirizzo_compl,
      city: candidate.comune,
      street: candidate.nome_strada,
      score: Number(candidate.score ?? 0),
    }));

    return {
      provider: 'italia-bul',
      query,
      normalizedAddress: streetQuery,
      matchedRegion: city.regionName,
      matchedCity: city.cityName,
      matchedRegionId: city.regionId,
      matchedCityId: city.cityId,
      officialSearchUrl: `${BUL_BASE_URL}/address-search/`,
      fixedLineHint: extractLikelyLandline(rawAddress),
      candidates,
      note: candidates.length > 0
        ? 'Ricerca indirizzo eseguita sul portale BUL ufficiale.'
        : 'Ricerca BUL eseguita senza candidati utili: verificare indirizzo o civico.',
      fetchedAt: new Date().toISOString(),
    };
  }
}

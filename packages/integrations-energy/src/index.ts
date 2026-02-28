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

  const url = araeraOpenDataUrl(commKey, 'PLACET', 'csv');

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

// ── EnergyIngestService ───────────────────────────────────────────────────────

/**
 * Esegue ingest completo: ARERA (open data reale) + stub operatori.
 * Da chiamare periodicamente (es. ogni settimana) via worker o endpoint admin.
 */
export class EnergyIngestService {
  async fetchAll(): Promise<EnergyIngestResult[]> {
    const [elec, gas] = await Promise.all([
      fetchAreraPlacet('electricity'),
      fetchAreraPlacet('gas'),
    ]);
    const stubs = getOperatorStubs();
    return [elec, gas, ...stubs];
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

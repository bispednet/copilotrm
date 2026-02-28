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
  /** Stub: restituisce metadati di tutti gli operatori con URL di accesso */
  async fetchAll(): Promise<TelcoIngestResult[]> {
    return getOperatorStubs();
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

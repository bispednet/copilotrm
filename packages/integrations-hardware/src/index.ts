/**
 * integrations-hardware — Preventivi hardware da fornitori italiani e internazionali.
 *
 * Catena priorità (configurabile tramite env vars):
 *   1. Runner.it        — rivenditore B2B preferito (RUNNER_API_KEY)
 *   2. Amazon IT        — fallback marketplace ampio (AMAZON_PAAPI_ACCESS_KEY + SECRET + PARTNER_TAG)
 *   3. Nexths.it        — rivenditore B2B preferito (NEXTHS_API_KEY)
 *   4. Esprinet         — distributore (ESPRINET_CLIENT_ID + CLIENT_SECRET)
 *   5. Ingram Micro     — distributore (INGRAM_CLIENT_ID + CLIENT_SECRET + CUSTOMER_NUMBER)
 *
 * Tutti i supplier non configurati restituiscono configured=false con searchUrl diretto.
 * Amazon: PA-API 5.0 con AWS Signature V4 — nota: deprecazione prevista 30 apr 2026.
 *
 * Registry fonti: /data/sources-registry.json
 */

import { createHmac, createHash } from 'node:crypto';

// ── Tipi ─────────────────────────────────────────────────────────────────────

export type HardwareSupplier = 'runner' | 'amazon' | 'nexths' | 'esprinet' | 'ingram';

export interface HardwareItem {
  id: string;
  title: string;
  brand?: string;
  ean?: string;
  price?: number;
  currency: string;
  availability: 'in-stock' | 'low-stock' | 'out-of-stock' | 'unknown';
  stockQty?: number;
  url?: string;
  imageUrl?: string;
  supplier: HardwareSupplier;
}

export interface SupplierResult {
  supplier: HardwareSupplier;
  priority: number;        // 1 = massima priorità
  configured: boolean;     // true = credenziali presenti
  items: HardwareItem[];
  searchUrl?: string;      // URL per ricerca manuale
  error?: string;
  durationMs?: number;
}

export interface HardwareQuoteResponse {
  query: string;
  results: SupplierResult[];
  searchedAt: string;
}

export interface SearchParams {
  query: string;
  category?: string;
  maxResults?: number;
}

// ── Helpers crypto per Amazon PA-API 5.0 AWS Sig V4 ─────────────────────────

function sha256hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacBuf(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function buildPaApiAuthorization(
  payload: string,
  accessKey: string,
  secretKey: string,
  amzDate: string,
): string {
  const dateStamp = amzDate.slice(0, 8);
  const region = 'eu-west-1';
  const service = 'ProductAdvertisingAPI';
  const host = 'webservices.amazon.it';
  const path = '/paapi5/searchitems';

  const payloadHash = sha256hex(payload);
  const canonicalHeaders =
    `content-encoding:amz-1.0\n` +
    `content-type:application/json; charset=utf-8\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems\n`;
  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';

  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256hex(canonicalRequest)}`;

  const kDate = hmacBuf('AWS4' + secretKey, dateStamp);
  const kRegion = hmacBuf(kDate, region);
  const kService = hmacBuf(kRegion, service);
  const kSigning = hmacBuf(kService, 'aws4_request');
  const signature = hmacBuf(kSigning, stringToSign).toString('hex');

  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function categoryToAmazonIndex(cat?: string): string {
  if (!cat) return 'Electronics';
  const map: Record<string, string> = {
    hardware: 'Electronics', pc: 'Computers', notebook: 'Computers',
    smartphone: 'Electronics', tablet: 'Electronics',
    stampante: 'OfficeProducts', tv: 'Electronics', console: 'VideoGames',
    router: 'Electronics', accessori: 'Electronics',
  };
  const k = cat.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (k.includes(key)) return val;
  }
  return 'Electronics';
}

// ── Amazon PA-API 5.0 ─────────────────────────────────────────────────────────
// Docs: https://webservices.amazon.com/paapi5/documentation/
// ATTENZIONE: PA-API deprecata 30 apr 2026 — pianificare migrazione a Creators API
// Creators API: https://affiliate-program.amazon.com/creatorsapi

async function searchAmazon(params: SearchParams): Promise<SupplierResult> {
  const t0 = Date.now();
  const searchUrl = `https://www.amazon.it/s?k=${encodeURIComponent(params.query)}`;
  const base: SupplierResult = { supplier: 'amazon', priority: 2, configured: false, items: [], searchUrl };

  const accessKey = process.env.AMAZON_PAAPI_ACCESS_KEY;
  const secretKey = process.env.AMAZON_PAAPI_SECRET_KEY;
  const partnerTag = process.env.AMAZON_PARTNER_TAG;
  if (!accessKey || !secretKey || !partnerTag) return base;

  base.configured = true;
  try {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';

    const payload = JSON.stringify({
      Keywords: params.query,
      Resources: [
        'ItemInfo.Title',
        'Offers.Listings.Price',
        'Images.Primary.Small',
      ],
      PartnerTag: partnerTag,
      PartnerType: 'Associates',
      Marketplace: 'www.amazon.it',
      ItemCount: Math.min(params.maxResults ?? 5, 10),
      SearchIndex: categoryToAmazonIndex(params.category),
    });

    const authorization = buildPaApiAuthorization(payload, accessKey, secretKey, amzDate);

    const res = await fetch('https://webservices.amazon.it/paapi5/searchitems', {
      method: 'POST',
      headers: {
        'content-encoding': 'amz-1.0',
        'content-type': 'application/json; charset=utf-8',
        'host': 'webservices.amazon.it',
        'x-amz-date': amzDate,
        'x-amz-target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems',
        'authorization': authorization,
      },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { ...base, error: `PA-API ${res.status}: ${err.slice(0, 300)}`, durationMs: Date.now() - t0 };
    }

    type PaApiResponse = {
      SearchResult?: {
        Items?: Array<{
          ASIN?: string;
          DetailPageURL?: string;
          ItemInfo?: { Title?: { DisplayValue?: string } };
          Images?: { Primary?: { Small?: { URL?: string } } };
          Offers?: { Listings?: Array<{ Price?: { Amount?: number; Currency?: string } }> };
        }>;
      };
    };

    const data = await res.json() as PaApiResponse;
    const items: HardwareItem[] = (data.SearchResult?.Items ?? []).map((item) => {
      const listing = item.Offers?.Listings?.[0];
      return {
        id: item.ASIN ?? '',
        title: item.ItemInfo?.Title?.DisplayValue ?? params.query,
        price: listing?.Price?.Amount,
        currency: listing?.Price?.Currency ?? 'EUR',
        availability: listing?.Price?.Amount != null ? 'in-stock' : 'unknown',
        url: item.DetailPageURL,
        imageUrl: item.Images?.Primary?.Small?.URL,
        supplier: 'amazon',
      };
    });

    return { ...base, items, durationMs: Date.now() - t0 };
  } catch (e) {
    return { ...base, error: String(e), durationMs: Date.now() - t0 };
  }
}

// ── Ingram Micro Reseller API v6 ──────────────────────────────────────────────
// Docs: https://developer.ingrammicro.com/reseller
// Auth: OAuth2 client_credentials
// Italy coverage: confermata nel portale developer

let ingramTokenCache: { token: string; expiresAt: number } | null = null;

async function ingramGetToken(): Promise<string | null> {
  if (ingramTokenCache && ingramTokenCache.expiresAt > Date.now() + 60_000) {
    return ingramTokenCache.token;
  }
  const clientId = process.env.INGRAM_CLIENT_ID;
  const clientSecret = process.env.INGRAM_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch('https://api.ingrammicro.com:443/oauth/oauth20/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    type TokenResponse = { access_token?: string; expires_in?: number };
    const data = await res.json() as TokenResponse;
    if (!data.access_token) return null;
    ingramTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return ingramTokenCache.token;
  } catch {
    return null;
  }
}

async function searchIngram(params: SearchParams): Promise<SupplierResult> {
  const t0 = Date.now();
  const base: SupplierResult = {
    supplier: 'ingram',
    priority: 5,
    configured: false,
    items: [],
    searchUrl: 'https://usa.ingrammicro.com/catalog',
  };

  if (!process.env.INGRAM_CLIENT_ID) return base;
  base.configured = true;

  const token = await ingramGetToken();
  if (!token) return { ...base, error: 'OAuth token Ingram fallito', durationMs: Date.now() - t0 };

  try {
    const customerNumber = process.env.INGRAM_CUSTOMER_NUMBER ?? '';
    const maxPage = Math.min(params.maxResults ?? 5, 20);
    const url = `https://api.ingrammicro.com:443/resellers/v6/catalog?keyword=${encodeURIComponent(params.query)}&pageSize=${maxPage}&includeProductAttributes=false`;

    const res = await fetch(url, {
      headers: {
        'authorization': `Bearer ${token}`,
        'im-customer-number': customerNumber,
        'im-correlation-id': `crm-${Date.now()}`,
        'im-country-code': 'IT',
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) return { ...base, error: `Ingram ${res.status}`, durationMs: Date.now() - t0 };

    type IngramCatalog = {
      catalog?: Array<{
        ingramPartNumber?: string;
        vendorPartNumber?: string;
        description?: string;
        vendorName?: string;
        upc?: string;
      }>;
    };

    const data = await res.json() as IngramCatalog;
    const items: HardwareItem[] = (data.catalog ?? []).map((p) => ({
      id: p.ingramPartNumber ?? p.vendorPartNumber ?? '',
      title: p.description ?? params.query,
      brand: p.vendorName,
      ean: p.upc,
      currency: 'EUR',
      availability: 'unknown' as const,
      supplier: 'ingram' as const,
    }));

    return { ...base, items, durationMs: Date.now() - t0 };
  } catch (e) {
    return { ...base, error: String(e), durationMs: Date.now() - t0 };
  }
}

// ── Runner.it ─────────────────────────────────────────────────────────────────
// Rivenditore B2B italiano preferito.
// API pubblica: non disponibile — richiede accordo B2B (https://www.runner.it/b2b/)
// RUNNER_API_KEY: placeholder per future integrazioni B2B

async function searchRunner(params: SearchParams): Promise<SupplierResult> {
  const searchUrl = `https://www.runner.it/search/?q=${encodeURIComponent(params.query)}`;
  const configured = !!process.env.RUNNER_API_KEY;
  return {
    supplier: 'runner',
    priority: 1,
    configured,
    items: [],
    searchUrl,
    error: configured
      ? 'RUNNER_API_KEY presente ma parser non implementato — contattare runner.it/b2b'
      : 'Nessuna API pubblica — accesso manuale su runner.it',
  };
}

// ── Nexths.it ─────────────────────────────────────────────────────────────────
// Rivenditore B2B italiano preferito.
// API pubblica: non disponibile — richiede accordo B2B
// NEXTHS_API_KEY: placeholder per future integrazioni B2B

async function searchNexths(params: SearchParams): Promise<SupplierResult> {
  const searchUrl = `https://www.nexths.it/ricerca/?s=${encodeURIComponent(params.query)}`;
  const configured = !!process.env.NEXTHS_API_KEY;
  return {
    supplier: 'nexths',
    priority: 3,
    configured,
    items: [],
    searchUrl,
    error: configured
      ? 'NEXTHS_API_KEY presente ma parser non implementato — contattare nexths.it'
      : 'Nessuna API pubblica — accesso manuale su nexths.it',
  };
}

// ── Esprinet EspriREALTIME ────────────────────────────────────────────────────
// Docs: https://www.esprinet.com/it/blog/servizi/esprirealtime/
// Auth: OAuth2 client_credentials (ESPRINET_CLIENT_ID + ESPRINET_CLIENT_SECRET)
// Nota: endpoint non pubblicamente documentato — richiedere accesso a Esprinet

async function searchEsprinet(params: SearchParams): Promise<SupplierResult> {
  const searchUrl = `https://www.esprinet.com/it/ricerca/?search=${encodeURIComponent(params.query)}`;
  const configured = !!(process.env.ESPRINET_CLIENT_ID && process.env.ESPRINET_CLIENT_SECRET);
  return {
    supplier: 'esprinet',
    priority: 4,
    configured,
    items: [],
    searchUrl,
    error: configured
      ? 'Credenziali Esprinet presenti ma endpoint EspriREALTIME non implementato'
      : 'ESPRINET_CLIENT_ID/SECRET non configurati — accesso manuale su esprinet.com',
  };
}

// ── HardwareQuoteChain ────────────────────────────────────────────────────────

/**
 * Esegue ricerca in parallelo su tutti i fornitori configurati.
 * Ordina per priorità: Runner (1) → Amazon (2) → Nexths (3) → Esprinet (4) → Ingram (5).
 * I fornitori non configurati restituiscono searchUrl per accesso manuale.
 */
export class HardwareQuoteChain {
  async search(params: SearchParams): Promise<HardwareQuoteResponse> {
    const [runner, amazon, nexths, esprinet, ingram] = await Promise.all([
      searchRunner(params),
      searchAmazon(params),
      searchNexths(params),
      searchEsprinet(params),
      searchIngram(params),
    ]);

    const results = [runner, amazon, nexths, esprinet, ingram].sort(
      (a, b) => a.priority - b.priority
    );

    return {
      query: params.query,
      results,
      searchedAt: new Date().toISOString(),
    };
  }

  /** Lista fornitori con stato configurazione */
  suppliers(): Array<{ supplier: HardwareSupplier; priority: number; configured: boolean; envVars: string[] }> {
    return [
      { supplier: 'runner', priority: 1, configured: !!process.env.RUNNER_API_KEY, envVars: ['RUNNER_API_KEY'] },
      { supplier: 'amazon', priority: 2, configured: !!(process.env.AMAZON_PAAPI_ACCESS_KEY && process.env.AMAZON_PAAPI_SECRET_KEY && process.env.AMAZON_PARTNER_TAG), envVars: ['AMAZON_PAAPI_ACCESS_KEY', 'AMAZON_PAAPI_SECRET_KEY', 'AMAZON_PARTNER_TAG'] },
      { supplier: 'nexths', priority: 3, configured: !!process.env.NEXTHS_API_KEY, envVars: ['NEXTHS_API_KEY'] },
      { supplier: 'esprinet', priority: 4, configured: !!(process.env.ESPRINET_CLIENT_ID && process.env.ESPRINET_CLIENT_SECRET), envVars: ['ESPRINET_CLIENT_ID', 'ESPRINET_CLIENT_SECRET'] },
      { supplier: 'ingram', priority: 5, configured: !!(process.env.INGRAM_CLIENT_ID && process.env.INGRAM_CLIENT_SECRET), envVars: ['INGRAM_CLIENT_ID', 'INGRAM_CLIENT_SECRET', 'INGRAM_CUSTOMER_NUMBER'] },
    ];
  }
}

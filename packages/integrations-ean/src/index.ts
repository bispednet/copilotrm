/**
 * integrations-ean — EAN/barcode product lookup
 *
 * Providers (priority order):
 * 1. ean-search.org   (token: EAN_SEARCH_TOKEN — free tier 1000/mese)
 * 2. UPCItemDB        (chiave: UPCITEMDB_USER_KEY — free trial 100/day)
 * 3. Open GTIN API    (fallback gratuito, nessuna chiave)
 * 4. Icecat open      (chiave: ICECAT_USERNAME — catalogo tech con immagini)
 *
 * Graceful degradation: ritorna null se tutti i provider falliscono.
 */

export interface EanProductInfo {
  ean: string;
  title: string;
  description: string;
  brand?: string;
  category?: string;
  imageUrl?: string;
  model?: string;
  weight?: string;
  icecat?: {
    productId?: string;
    dataSheetUrl?: string;
    highResImageUrl?: string;
  };
}

export class EanLookupClient {
  private readonly eanSearchToken: string | undefined;
  private readonly upcItemDbKey: string | undefined;
  private readonly upcItemDbUrl: string;
  private readonly icecatUser: string | undefined;
  private readonly timeoutMs: number;

  constructor() {
    this.eanSearchToken = process.env.EAN_SEARCH_TOKEN;
    this.upcItemDbKey = process.env.UPCITEMDB_USER_KEY;
    this.upcItemDbUrl = process.env.UPCITEMDB_URL ?? 'https://api.upcitemdb.com/prod/trial/lookup';
    this.icecatUser = process.env.ICECAT_USERNAME;
    this.timeoutMs = Number(process.env.EAN_LOOKUP_TIMEOUT_MS ?? 8000);
  }

  async lookup(ean: string): Promise<EanProductInfo | null> {
    const clean = ean.replace(/\D/g, '');
    if (!clean || clean.length < 8) return null;

    // Provider 1: ean-search.org (requires token)
    if (this.eanSearchToken) {
      const result = await this._eanSearch(clean);
      if (result) return result;
    }

    // Provider 2: UPCItemDB
    const upcResult = await this._upcItemDb(clean);
    if (upcResult) return upcResult;

    // Provider 3: Icecat (for tech products — useful for hardware/smartphone)
    if (this.icecatUser) {
      const icecatResult = await this._icecat(clean);
      if (icecatResult) return icecatResult;
    }

    return null;
  }

  async lookupMany(eans: string[]): Promise<Map<string, EanProductInfo>> {
    const results = new Map<string, EanProductInfo>();
    await Promise.all(
      eans.map(async (ean) => {
        const info = await this.lookup(ean);
        if (info) results.set(ean, info);
      })
    );
    return results;
  }

  private async _eanSearch(ean: string): Promise<EanProductInfo | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `https://api.ean-search.org/api?token=${this.eanSearchToken}&op=barcode-lookup&ean=${ean}&format=json`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CopilotRM/1.0 EAN Lookup', Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Array<Record<string, unknown>>;
      if (!data?.[0]?.name) return null;
      const item = data[0];
      return {
        ean,
        title: String(item.name ?? ''),
        description: String(item.name ?? ''),
        category: item.categoryName ? String(item.categoryName) : undefined,
        imageUrl: item.isbnImage ? String(item.isbnImage) : undefined,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async _upcItemDb(ean: string): Promise<EanProductInfo | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'CopilotRM/1.0 EAN Lookup',
        Accept: 'application/json',
      };
      if (this.upcItemDbKey) headers['user_key'] = this.upcItemDbKey;
      const res = await fetch(`${this.upcItemDbUrl}?upc=${ean}`, { signal: controller.signal, headers });
      if (!res.ok) return null;
      const data = (await res.json()) as { items?: Array<Record<string, unknown>> };
      const item = data?.items?.[0];
      if (!item) return null;
      return {
        ean,
        title: String(item.title ?? ''),
        description: String(item.description ?? item.title ?? ''),
        brand: item.brand ? String(item.brand) : undefined,
        category: item.category ? String(item.category) : undefined,
        imageUrl: (item.images as string[] | undefined)?.[0],
        model: item.model ? String(item.model) : undefined,
        weight: item.weight ? String(item.weight) : undefined,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async _icecat(ean: string): Promise<EanProductInfo | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Icecat Open Catalog: XML or JSON by EAN
      const url = `https://icecat.biz/api/product?UserName=${encodeURIComponent(this.icecatUser!)}&Language=it&EAN=${ean}&Content=M`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CopilotRM/1.0 Icecat Lookup', Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { data?: Record<string, unknown> };
      const p = data?.data;
      if (!p) return null;
      const generalInfo = p['GeneralInfo'] as Record<string, unknown> | undefined;
      const productName = generalInfo?.['ProductName'] ? String(generalInfo['ProductName']) : undefined;
      const brand = (generalInfo?.['BrandInfo'] as Record<string, unknown> | undefined)?.['BrandName']
        ? String((generalInfo!['BrandInfo'] as Record<string, unknown>)['BrandName'])
        : undefined;
      if (!productName) return null;
      const image = (p['Image'] as Record<string, unknown> | undefined)?.['HighPic']
        ? String((p['Image'] as Record<string, unknown>)['HighPic'])
        : undefined;
      return {
        ean,
        title: productName,
        description: productName,
        brand,
        imageUrl: image,
        icecat: {
          productId: p['ProductID'] ? String(p['ProductID']) : undefined,
          highResImageUrl: image,
        },
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * integrations-rss — RSS feed fetcher + parser senza dipendenze esterne.
 * Usa fetch nativo (Node 18+) e parsing XML con regex.
 */

export interface RssItem {
  /** Unique identifier (guid o link) */
  id: string;
  title: string;
  description: string;
  link: string;
  pubDate?: string;
  category?: string;
  sourceName?: string;
}

export interface RssSource {
  url: string;
  name: string;
  category?: string;
  /** Timeout ms per singola fetch (default 10 000) */
  timeoutMs?: number;
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  // CDATA
  const cd = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'));
  if (cd) return cd[1].trim();
  // plain
  const pl = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return pl ? pl[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : '';
}

function parseItems(xml: string, sourceName?: string): RssItem[] {
  const items: RssItem[] = [];
  // support both RSS <item> and Atom <entry>
  const tagRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const raw = m[1];
    const title = extractTag(raw, 'title');
    const link = extractTag(raw, 'link') || extractTag(raw, 'guid');
    const description =
      extractTag(raw, 'description') ||
      extractTag(raw, 'summary') ||
      extractTag(raw, 'content');
    const pubDate = extractTag(raw, 'pubDate') || extractTag(raw, 'published') || extractTag(raw, 'updated');
    const category = extractTag(raw, 'category');
    const guid = extractTag(raw, 'guid') || link;
    if (!title || !guid) continue;
    items.push({
      id: guid,
      title,
      description,
      link: link || guid,
      pubDate: pubDate || undefined,
      category: category || undefined,
      sourceName,
    });
  }
  return items;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Scarica e parsa un feed RSS/Atom.
 * Ritorna lista vuota se il feed è irraggiungibile o malformato (no throw).
 */
export async function fetchRssItems(source: RssSource): Promise<RssItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), source.timeoutMs ?? 10_000);
  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CopilotRM/1.0 RSS Aggregator', Accept: 'application/rss+xml, application/atom+xml, text/xml, */*' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseItems(xml, source.name);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scarica più feed in parallelo.
 */
export async function fetchAllRssFeeds(sources: RssSource[]): Promise<RssItem[]> {
  const results = await Promise.all(sources.map((s) => fetchRssItems(s)));
  return results.flat();
}

// ─── State tracker ───────────────────────────────────────────────────────────

/**
 * Traccia gli item già visti per evitare duplicati tra run successivi.
 * Usa Set in-memory; persistenza opzionale tramite callback.
 */
export class RssStateTracker {
  private seen: Set<string>;

  constructor(initialSeen: string[] = []) {
    this.seen = new Set(initialSeen);
  }

  /** Filtra solo gli item NON ancora visti */
  filterNew(items: RssItem[]): RssItem[] {
    return items.filter((item) => !this.seen.has(item.id));
  }

  /** Marca gli item come visti */
  markSeen(items: RssItem[]): void {
    for (const item of items) this.seen.add(item.id);
  }

  /** Lista di tutti gli id visti (per persistenza) */
  getSeenIds(): string[] {
    return [...this.seen];
  }

  get size(): number {
    return this.seen.size;
  }
}

// ─── Domain event builder ─────────────────────────────────────────────────────

export interface RssIngestedEvent {
  type: 'rss.item.ingested';
  occurredAt: string;
  payload: {
    id: string;
    title: string;
    description: string;
    link: string;
    pubDate?: string;
    category?: string;
    sourceName?: string;
  };
}

export function rssItemToEvent(item: RssItem): RssIngestedEvent {
  return {
    type: 'rss.item.ingested',
    occurredAt: new Date().toISOString(),
    payload: {
      id: item.id,
      title: item.title,
      description: item.description,
      link: item.link,
      pubDate: item.pubDate,
      category: item.category,
      sourceName: item.sourceName,
    },
  };
}

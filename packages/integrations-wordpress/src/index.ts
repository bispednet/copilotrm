/**
 * integrations-wordpress — WordPress REST API client.
 * Autenticazione via Application Password (consigliato su WP 5.6+).
 * Nessuna dipendenza esterna — usa fetch nativo (Node 18+).
 */

export interface WordPressClientConfig {
  /** Es. https://myblog.example.com */
  siteUrl: string;
  /** Username WordPress */
  username: string;
  /** Application Password (Impostazioni → Password Applicazioni in WP) */
  applicationPassword: string;
  /** Timeout ms (default 20 000) */
  timeoutMs?: number;
}

export interface WordPressPost {
  title: string;
  /** Contenuto HTML o testo del post */
  content: string;
  status?: 'publish' | 'draft' | 'pending' | 'private';
  excerpt?: string;
  /** Array di ID categoria WordPress */
  categories?: number[];
  /** Array di ID tag WordPress */
  tags?: number[];
  /** Slug personalizzato */
  slug?: string;
  /** Immagine in evidenza (ID media WP) */
  featuredMediaId?: number;
}

export interface WordPressPostResult {
  id: number;
  link: string;
  status: string;
  slug: string;
  title: string;
}

export interface WordPressCategory {
  id: number;
  name: string;
  slug: string;
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;

  constructor(config: WordPressClientConfig) {
    this.baseUrl = config.siteUrl.replace(/\/$/, '');
    this.authHeader = `Basic ${btoa(`${config.username}:${config.applicationPassword}`)}`;
    this.timeoutMs = config.timeoutMs ?? 20_000;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/wp-json/wp/v2${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => res.statusText);
        throw new Error(`WordPress API ${res.status}: ${body}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Crea un nuovo post */
  async createPost(post: WordPressPost): Promise<WordPressPostResult> {
    const body: Record<string, unknown> = {
      title: post.title,
      content: post.content,
      status: post.status ?? 'draft',
    };
    if (post.excerpt) body.excerpt = post.excerpt;
    if (post.categories?.length) body.categories = post.categories;
    if (post.tags?.length) body.tags = post.tags;
    if (post.slug) body.slug = post.slug;
    if (post.featuredMediaId) body.featured_media = post.featuredMediaId;

    const data = await this.request<{ id: number; link: string; status: string; slug: string; title: { rendered: string } }>(
      '/posts',
      { method: 'POST', body: JSON.stringify(body) }
    );
    return { id: data.id, link: data.link, status: data.status, slug: data.slug, title: data.title.rendered };
  }

  /** Aggiorna un post esistente */
  async updatePost(postId: number, updates: Partial<WordPressPost>): Promise<WordPressPostResult> {
    const body: Record<string, unknown> = {};
    if (updates.title !== undefined) body.title = updates.title;
    if (updates.content !== undefined) body.content = updates.content;
    if (updates.status !== undefined) body.status = updates.status;
    if (updates.excerpt !== undefined) body.excerpt = updates.excerpt;
    if (updates.categories !== undefined) body.categories = updates.categories;
    if (updates.tags !== undefined) body.tags = updates.tags;

    const data = await this.request<{ id: number; link: string; status: string; slug: string; title: { rendered: string } }>(
      `/posts/${postId}`,
      { method: 'POST', body: JSON.stringify(body) }
    );
    return { id: data.id, link: data.link, status: data.status, slug: data.slug, title: data.title.rendered };
  }

  /** Lista categorie */
  async getCategories(): Promise<WordPressCategory[]> {
    return this.request<WordPressCategory[]>('/categories?per_page=100', { method: 'GET' });
  }

  /** Crea categoria se non esiste, ritorna id */
  async getOrCreateCategory(name: string): Promise<number> {
    const categories = await this.getCategories();
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase() || c.slug === name.toLowerCase());
    if (existing) return existing.id;
    const created = await this.request<{ id: number }>('/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return created.id;
  }
}

export function createWordPressClient(config: WordPressClientConfig): WordPressClient {
  return new WordPressClient(config);
}

/** Crea WordPressClient da variabili d'ambiente */
export function createWordPressClientFromEnv(
  env: Record<string, string | undefined> = (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  )
): WordPressClient | null {
  const siteUrl = env.WORDPRESS_SITE_URL;
  const username = env.WORDPRESS_USERNAME;
  const applicationPassword = env.WORDPRESS_APP_PASSWORD;
  if (!siteUrl || !username || !applicationPassword) return null;
  return new WordPressClient({ siteUrl, username, applicationPassword });
}
